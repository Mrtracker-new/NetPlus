//! Bounded HTTP Diagnostic Probe with HTTPS & TLS Handshake Support.

use super::models::HttpProbeOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

const MAX_RESPONSE_BYTES: usize = 256 * 1024; // 256 KB bounded response limit
const MAX_TIMEOUT_SECS: u64 = 4; // 4s maximum bounded timeout for responsive non-blocking probes

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ParsedHttpUrl<'a> {
    pub scheme: Option<&'a str>,
    pub host: &'a str,
    pub port: u16,
    pub path: String,
    pub is_tls: bool,
}

pub(crate) fn parse_http_target(raw_url: &str) -> Option<ParsedHttpUrl<'_>> {
    let raw = raw_url.trim();
    if raw.is_empty() {
        return None;
    }

    // Split scheme if present
    let (scheme, rest) = if let Some(idx) = raw.find("://") {
        (Some(&raw[..idx]), &raw[idx + 3..])
    } else {
        (None, raw)
    };

    // Separate host_port from path / query / fragment
    let delim_idx = rest.find(|c| c == '/' || c == '?' || c == '#');
    let (raw_host_port, raw_path) = match delim_idx {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };

    // Strip userinfo (user:pass@) if present
    let host_port = if let Some(at_idx) = raw_host_port.rfind('@') {
        &raw_host_port[at_idx + 1..]
    } else {
        raw_host_port
    };

    // Normalize request path: strip fragment (#...) and ensure leading slash
    let path_without_frag = if let Some(hash_idx) = raw_path.find('#') {
        &raw_path[..hash_idx]
    } else {
        raw_path
    };

    let path = if path_without_frag.is_empty() {
        "/".to_string()
    } else if !path_without_frag.starts_with('/') {
        format!("/{path_without_frag}")
    } else {
        path_without_frag.to_string()
    };

    // Extract host and explicit port
    let (host, explicit_port) = if host_port.starts_with('[') {
        if let Some(bracket_end) = host_port.find(']') {
            let h = &host_port[1..bracket_end];
            let after = &host_port[bracket_end + 1..];
            let p = if let Some(colon_idx) = after.find(':') {
                after[colon_idx + 1..].parse::<u16>().ok()
            } else {
                None
            };
            (h, p)
        } else {
            (host_port, None)
        }
    } else if let Some(colon_idx) = host_port.rfind(':') {
        let maybe_port = &host_port[colon_idx + 1..];
        if let Ok(p) = maybe_port.parse::<u16>() {
            if !host_port[..colon_idx].contains(':') {
                (&host_port[..colon_idx], Some(p))
            } else {
                (host_port, None)
            }
        } else {
            (host_port, None)
        }
    } else {
        (host_port, None)
    };

    if host.is_empty() {
        return None;
    }

    let scheme_lower = scheme.map(|s| s.to_ascii_lowercase());
    let (port, is_tls) = match (scheme_lower.as_deref(), explicit_port) {
        (Some("https"), Some(p)) => (p, true),
        (Some("https"), None) => (443, true),
        (Some("http"), Some(p)) => (p, false),
        (Some("http"), None) => (80, false),
        (None, Some(p)) => (p, p == 443 || p == 8443),
        (None, None) => (443, true), // Default to port 443 with TLS
        (Some(_), Some(p)) => (p, false),
        (Some(_), None) => (80, false),
    };

    Some(ParsedHttpUrl {
        scheme,
        host,
        port,
        path,
        is_tls,
    })
}

fn get_tls_client_config() -> std::result::Result<Arc<ClientConfig>, String> {
    static CONFIG: OnceLock<std::result::Result<Arc<ClientConfig>, String>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut root_store = RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let provider = rustls::crypto::ring::default_provider();
            let config = ClientConfig::builder_with_provider(Arc::new(provider))
                .with_safe_default_protocol_versions()
                .map_err(|e| format!("Failed to set TLS protocol versions: {e}"))?
                .with_root_certificates(root_store)
                .with_no_client_auth();
            Ok(Arc::new(config))
        })
        .clone()
}

enum HttpTransport {
    Plain(TcpStream),
    Tls(StreamOwned<ClientConnection, TcpStream>),
}

impl Read for HttpTransport {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            HttpTransport::Plain(s) => s.read(buf),
            HttpTransport::Tls(s) => s.read(buf),
        }
    }
}

impl Write for HttpTransport {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            HttpTransport::Plain(s) => s.write(buf),
            HttpTransport::Tls(s) => s.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            HttpTransport::Plain(s) => s.flush(),
            HttpTransport::Tls(s) => s.flush(),
        }
    }
}

impl HttpTransport {
    fn set_read_timeout(&self, dur: Option<Duration>) -> std::io::Result<()> {
        match self {
            HttpTransport::Plain(s) => s.set_read_timeout(dur),
            HttpTransport::Tls(s) => s.sock.set_read_timeout(dur),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpProbe {
    pub url: String,
    pub timeout_secs: u64,
}

impl HttpProbe {
    pub fn new(url: String) -> Self {
        Self {
            url,
            timeout_secs: MAX_TIMEOUT_SECS,
        }
    }
}

impl DiagnosticProbe for HttpProbe {
    type Output = HttpProbeOutput;

    fn run(&self, cancel: Arc<AtomicBool>) -> Result<Self::Output> {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(HttpProbeOutput {
                url: self.url.clone(),
                status_code: None,
                connect_ms: None,
                ttfb_ms: None,
                transfer_ms: None,
                tls_ms: None,
                error: Some("Operation cancelled".to_string()),
                limitation: Some("TLS timing unavailable".to_string()),
                source: "live".to_string(),
            });
        }

        let parsed = match parse_http_target(&self.url) {
            Some(p) => p,
            None => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: None,
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: None,
                    error: Some("Invalid or empty host".to_string()),
                    limitation: Some("TLS timing unavailable".to_string()),
                    source: "live".to_string(),
                });
            }
        };

        let host = parsed.host;
        let port = parsed.port;
        let path = parsed.path;
        let is_tls = parsed.is_tls;
        let timeout = Duration::from_secs(self.timeout_secs.min(MAX_TIMEOUT_SECS));

        // Resolve socket address
        let addrs_iter = match (host, port).to_socket_addrs() {
            Ok(iter) => iter,
            Err(e) => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: None,
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: None,
                    error: Some(format!("DNS resolution failed: {e}")),
                    limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                    source: "live".to_string(),
                });
            }
        };

        let socket_addr = match addrs_iter.into_iter().next() {
            Some(addr) => addr,
            None => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: None,
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: None,
                    error: Some("No socket addresses found for host".to_string()),
                    limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                    source: "live".to_string(),
                });
            }
        };

        // TCP Connect Phase
        let connect_start = Instant::now();
        let mut stream = match TcpStream::connect_timeout(&socket_addr, timeout) {
            Ok(s) => s,
            Err(e) => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: None,
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: None,
                    error: Some(format!("TCP connection failed: {e}")),
                    limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                    source: "live".to_string(),
                });
            }
        };
        let connect_ms = connect_start.elapsed().as_secs_f32() * 1000.0;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(HttpProbeOutput {
                url: self.url.clone(),
                status_code: None,
                connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                ttfb_ms: None,
                transfer_ms: None,
                tls_ms: None,
                error: Some("Operation cancelled".to_string()),
                limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                source: "live".to_string(),
            });
        }

        // Optional TLS Handshake Phase
        let (mut transport, tls_ms_opt) = if is_tls {
            let config = match get_tls_client_config() {
                Ok(cfg) => cfg,
                Err(e) => {
                    return Ok(HttpProbeOutput {
                        url: self.url.clone(),
                        status_code: None,
                        connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                        ttfb_ms: None,
                        transfer_ms: None,
                        tls_ms: None,
                        error: Some(format!("TLS config error: {e}")),
                        limitation: None,
                        source: "live".to_string(),
                    });
                }
            };

            // RFC 6066: hostname in SNI must not have trailing dots
            let host_sni = host.trim_end_matches('.');
            let server_name = match ServerName::try_from(host_sni.to_string()) {
                Ok(sn) => sn,
                Err(e) => {
                    return Ok(HttpProbeOutput {
                        url: self.url.clone(),
                        status_code: None,
                        connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                        ttfb_ms: None,
                        transfer_ms: None,
                        tls_ms: None,
                        error: Some(format!("Invalid TLS server name: {e}")),
                        limitation: None,
                        source: "live".to_string(),
                    });
                }
            };

            let mut conn = match ClientConnection::new(config, server_name) {
                Ok(c) => c,
                Err(e) => {
                    return Ok(HttpProbeOutput {
                        url: self.url.clone(),
                        status_code: None,
                        connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                        ttfb_ms: None,
                        transfer_ms: None,
                        tls_ms: None,
                        error: Some(format!("TLS connection init failed: {e}")),
                        limitation: None,
                        source: "live".to_string(),
                    });
                }
            };

            let tls_start = Instant::now();
            while conn.is_handshaking() {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return Ok(HttpProbeOutput {
                        url: self.url.clone(),
                        status_code: None,
                        connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                        ttfb_ms: None,
                        transfer_ms: None,
                        tls_ms: None,
                        error: Some("Operation cancelled".to_string()),
                        limitation: None,
                        source: "live".to_string(),
                    });
                }
                if tls_start.elapsed() >= timeout {
                    return Ok(HttpProbeOutput {
                        url: self.url.clone(),
                        status_code: None,
                        connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                        ttfb_ms: None,
                        transfer_ms: None,
                        tls_ms: None,
                        error: Some("TLS handshake timed out".to_string()),
                        limitation: None,
                        source: "live".to_string(),
                    });
                }
                match conn.complete_io(&mut stream) {
                    Ok(_) => {}
                    Err(e) => {
                        return Ok(HttpProbeOutput {
                            url: self.url.clone(),
                            status_code: None,
                            connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                            ttfb_ms: None,
                            transfer_ms: None,
                            tls_ms: None,
                            error: Some(format!("TLS handshake failed: {e}")),
                            limitation: None,
                            source: "live".to_string(),
                        });
                    }
                }
            }
            let tls_ms = tls_start.elapsed().as_secs_f32() * 1000.0;
            (HttpTransport::Tls(StreamOwned::new(conn, stream)), Some(tls_ms))
        } else {
            (HttpTransport::Plain(stream), None)
        };

        // Format RFC 7230 compliant Host header (IPv6 literal must be bracketed)
        let host_display = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        let host_hdr = if (is_tls && port == 443) || (!is_tls && port == 80) {
            host_display
        } else {
            format!("{host_display}:{port}")
        };

        let req_str = format!(
            "GET {path} HTTP/1.1\r\nHost: {host_hdr}\r\nUser-Agent: NetPlus-Diagnostics/1.0\r\nConnection: close\r\nAccept: */*\r\n\r\n"
        );

        let ttfb_start = Instant::now();
        if let Err(e) = transport.write_all(req_str.as_bytes()) {
            return Ok(HttpProbeOutput {
                url: self.url.clone(),
                status_code: None,
                connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                ttfb_ms: None,
                transfer_ms: None,
                tls_ms: tls_ms_opt.map(|m| (m * 10.0).round() / 10.0),
                error: Some(format!("Failed to write HTTP request: {e}")),
                limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                source: "live".to_string(),
            });
        }
        let _ = transport.flush();

        // Read first chunk (TTFB)
        let mut buffer = [0u8; 4096];
        let first_read = match transport.read(&mut buffer) {
            Ok(0) => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: tls_ms_opt.map(|m| (m * 10.0).round() / 10.0),
                    error: Some("Server closed connection without response".to_string()),
                    limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                    source: "live".to_string(),
                });
            }
            Ok(n) => n,
            Err(e) => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: tls_ms_opt.map(|m| (m * 10.0).round() / 10.0),
                    error: Some(format!("Failed reading response: {e}")),
                    limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
                    source: "live".to_string(),
                });
            }
        };
        let ttfb_ms = ttfb_start.elapsed().as_secs_f32() * 1000.0;

        // Parse HTTP status code and expected total bytes from initial chunk
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut response = httparse::Response::new(&mut headers);
        let (status_code, expected_total_bytes) = match response.parse(&buffer[..first_read]) {
            Ok(httparse::Status::Complete(header_len)) => {
                let mut expected = None;
                for h in response.headers.iter() {
                    if h.name.eq_ignore_ascii_case("content-length") {
                        if let Ok(val_str) = std::str::from_utf8(h.value) {
                            if let Ok(body_len) = val_str.trim().parse::<usize>() {
                                expected = Some(header_len + body_len);
                            }
                        }
                        break;
                    }
                }
                (response.code, expected)
            }
            Ok(httparse::Status::Partial) => (response.code, None),
            Err(_) => (None, None),
        };

        // Read remaining response up to MAX_RESPONSE_BYTES or expected_total_bytes
        let _ = transport.set_read_timeout(Some(Duration::from_millis(100)));
        let transfer_start = Instant::now();
        let mut total_bytes = first_read;

        // If the complete response was already contained in the first read, finish immediately
        let already_complete = expected_total_bytes.map_or(false, |expected| total_bytes >= expected);

        if !already_complete {
            while total_bytes < MAX_RESPONSE_BYTES && transfer_start.elapsed() < timeout {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                if let Some(expected) = expected_total_bytes {
                    if total_bytes >= expected {
                        break;
                    }
                }
                match transport.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        total_bytes += n;
                        if let Some(expected) = expected_total_bytes {
                            if total_bytes >= expected {
                                break;
                            }
                        }
                    }
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // 100ms elapsed with no incoming bytes: finish read to avoid blocking full timeout
                        break;
                    }
                    Err(_) => break,
                }
            }
        }
        let transfer_ms = transfer_start.elapsed().as_secs_f32() * 1000.0;

        let cancelled = cancel.load(std::sync::atomic::Ordering::Relaxed);
        let error = if cancelled {
            Some("Operation cancelled".to_string())
        } else {
            None
        };

        Ok(HttpProbeOutput {
            url: self.url.clone(),
            status_code,
            connect_ms: Some((connect_ms * 10.0).round() / 10.0),
            ttfb_ms: Some((ttfb_ms * 10.0).round() / 10.0),
            transfer_ms: Some((transfer_ms * 10.0).round() / 10.0),
            tls_ms: tls_ms_opt.map(|m| (m * 10.0).round() / 10.0),
            error,
            limitation: if is_tls { None } else { Some("TLS timing unavailable".to_string()) },
            source: "live".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn test_parse_http_target_varieties() {
        let p = parse_http_target("https://cloudflare.com").expect("parse https");
        assert_eq!(p.host, "cloudflare.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/");
        assert!(p.is_tls);

        let p = parse_http_target("http://cloudflare.com").expect("parse http");
        assert_eq!(p.host, "cloudflare.com");
        assert_eq!(p.port, 80);
        assert!(!p.is_tls);

        let p = parse_http_target("1.1.1.1").expect("parse ip default");
        assert_eq!(p.host, "1.1.1.1");
        assert_eq!(p.port, 443);
        assert!(p.is_tls);

        let p = parse_http_target("cloudflare.com").expect("parse domain default");
        assert_eq!(p.host, "cloudflare.com");
        assert_eq!(p.port, 443);
        assert!(p.is_tls);

        let p = parse_http_target("1.1.1.1:80").expect("parse ip port 80");
        assert_eq!(p.host, "1.1.1.1");
        assert_eq!(p.port, 80);
        assert!(!p.is_tls);

        let p = parse_http_target("example.com:443/test").expect("parse port 443");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/test");
        assert!(p.is_tls);

        let p = parse_http_target("example.com:8443/test").expect("parse port 8443");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 8443);
        assert_eq!(p.path, "/test");
        assert!(p.is_tls);

        let p = parse_http_target("http://[::1]:59999/status").expect("parse ipv6");
        assert_eq!(p.host, "::1");
        assert_eq!(p.port, 59999);
        assert_eq!(p.path, "/status");
        assert!(!p.is_tls);

        // Userinfo stripping
        let p = parse_http_target("https://admin:secret@example.com/api").expect("parse userinfo");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/api");
        assert!(p.is_tls);

        // Query string and fragment handling
        let p = parse_http_target("https://example.com?query=1#section").expect("parse query no slash");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 443);
        assert_eq!(p.path, "/?query=1");
        assert!(p.is_tls);

        let p = parse_http_target("https://example.com/api/v1?search=test#details").expect("parse query slash");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.path, "/api/v1?search=test");

        assert!(parse_http_target("   ").is_none());
    }

    #[test]
    fn test_http_probe_local_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test port");
        let local_addr = listener.local_addr().expect("local addr");

        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nHello, World!";
                let _ = stream.write_all(response.as_bytes());
            }
        });

        let probe = HttpProbe::new(format!("http://{}", local_addr));
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("http probe run");

        assert_eq!(out.source, "live");
        assert_eq!(out.status_code, Some(200));
        assert!(out.connect_ms.is_some());
        assert!(out.ttfb_ms.is_some());
        assert!(out.transfer_ms.is_some());
        assert!(out.tls_ms.is_none());
        assert_eq!(out.limitation, Some("TLS timing unavailable".to_string()));
    }

    #[test]
    fn test_http_probe_content_length_fast_finish() {
        // Mock server that sends full Content-Length but leaves the connection open
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test port");
        let local_addr = listener.local_addr().expect("local addr");

        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\nHello, World!";
                let _ = stream.write_all(response.as_bytes());
                // Leave stream open to simulate keep-alive server
                thread::sleep(Duration::from_millis(500));
            }
        });

        let probe = HttpProbe::new(format!("http://{}", local_addr));
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let start = Instant::now();
        let out = probe.run(cancel).expect("http probe run");
        let duration = start.elapsed();

        assert_eq!(out.status_code, Some(200));
        // Must complete promptly without waiting for socket timeout
        assert!(
            duration < Duration::from_millis(200),
            "Probe should complete immediately when Content-Length is satisfied, took {:?}",
            duration
        );
    }

    #[test]
    fn test_http_probe_connection_refused() {
        // Connect to a closed port on localhost
        let probe = HttpProbe::new("http://127.0.0.1:59999".to_string());
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("http probe run");

        assert_eq!(out.source, "live");
        assert!(out.error.is_some());
        assert!(out.status_code.is_none());
        assert!(out.connect_ms.is_none());
    }

    #[test]
    fn test_http_probe_bracketed_ipv6() {
        let probe = HttpProbe::new("http://[::1]:59999/status".to_string());
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("http probe run");
        assert_eq!(out.source, "live");
        assert!(out.error.is_some());
    }

    #[test]
    fn test_http_probe_mid_execution_cancellation() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test port");
        let local_addr = listener.local_addr().expect("local addr");
        let stop_server = std::sync::Arc::new(AtomicBool::new(false));
        let stop_clone = stop_server.clone();

        let server_thread = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\ninitial-chunk";
                let _ = stream.write_all(response.as_bytes());
                while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(10));
                }
            }
        });

        let probe = HttpProbe::new(format!("http://{}", local_addr));
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel.clone();

        let flag_set_time = std::sync::Arc::new(std::sync::Mutex::new(None));
        let flag_set_time_clone = flag_set_time.clone();

        let trigger = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            *flag_set_time_clone.lock().unwrap() = Some(Instant::now());
            cancel_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        });

        let out = probe.run(cancel).expect("http probe run");
        let finish_time = Instant::now();
        trigger.join().expect("join trigger");
        stop_server.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = server_thread.join();

        let flag_time = flag_set_time.lock().unwrap().expect("flag set");
        let halt_duration = finish_time.saturating_duration_since(flag_time);
        println!("HTTP mid-execution halt latency: {:?}", halt_duration);

        assert!(
            halt_duration < Duration::from_millis(150),
            "HTTP probe must halt promptly upon cancellation flag, took {:?}",
            halt_duration
        );
        assert_eq!(out.error, Some("Operation cancelled".to_string()));
    }

    #[test]
    fn test_http_probe_live_cloudflare_tls() {
        let probe = HttpProbe::new("https://cloudflare.com".to_string());
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("http probe run");

        assert_eq!(out.source, "live");
        if out.error.is_none() {
            assert!(out.status_code.is_some(), "Expected HTTP status code");
            assert!(out.connect_ms.is_some(), "Expected TCP connect time");
            assert!(out.tls_ms.is_some(), "Expected discrete TLS handshake duration");
            assert!(out.ttfb_ms.is_some(), "Expected TTFB duration");
            assert!(out.transfer_ms.is_some(), "Expected transfer duration");
            assert_eq!(out.limitation, None, "Limitation must be cleared when TLS succeeds");
            println!(
                "Cloudflare probe success: status={:?} connect_ms={:?} tls_ms={:?} ttfb_ms={:?}",
                out.status_code, out.connect_ms, out.tls_ms, out.ttfb_ms
            );
        } else {
            println!("Cloudflare live probe skipped or network error: {:?}", out.error);
        }
    }

    #[test]
    fn test_http_probe_live_1_1_1_1_tls() {
        let probe = HttpProbe::new("1.1.1.1".to_string());
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("http probe run");

        assert_eq!(out.source, "live");
        if out.error.is_none() {
            assert!(out.connect_ms.is_some(), "Expected TCP connect time");
            assert!(out.tls_ms.is_some(), "Expected discrete TLS handshake duration for 1.1.1.1");
            assert!(out.ttfb_ms.is_some(), "Expected TTFB duration");
            assert_eq!(out.limitation, None, "Limitation must be cleared when TLS succeeds");
            println!(
                "1.1.1.1 probe success: status={:?} connect_ms={:?} tls_ms={:?} ttfb_ms={:?}",
                out.status_code, out.connect_ms, out.tls_ms, out.ttfb_ms
            );
        } else {
            println!("1.1.1.1 live probe skipped or network error: {:?}", out.error);
        }
    }
}
