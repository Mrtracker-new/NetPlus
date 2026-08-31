//! Bounded HTTP Diagnostic Probe.

use super::models::HttpProbeOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

const MAX_RESPONSE_BYTES: usize = 256 * 1024; // 256 KB bounded response limit
const MAX_TIMEOUT_SECS: u64 = 4; // 4s maximum bounded timeout for responsive non-blocking probes

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

    fn run(&self, cancel: AtomicBool) -> Result<Self::Output> {
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

        // Parse host, port, and path from URL
        let raw = self.url.trim();
        let (host_port, path) = if let Some(idx) = raw.find("://") {
            let rest = &raw[idx + 3..];
            if let Some(slash_idx) = rest.find('/') {
                (&rest[..slash_idx], &rest[slash_idx..])
            } else {
                (rest, "/")
            }
        } else if let Some(slash_idx) = raw.find('/') {
            (&raw[..slash_idx], &raw[slash_idx..])
        } else {
            (raw, "/")
        };

        let (host, port) = if host_port.starts_with('[') {
            if let Some(bracket_end) = host_port.find(']') {
                let h = &host_port[1..bracket_end];
                let after = &host_port[bracket_end + 1..];
                let p = if let Some(colon_idx) = after.find(':') {
                    after[colon_idx + 1..].parse::<u16>().unwrap_or(80)
                } else {
                    80
                };
                (h, p)
            } else {
                (host_port, 80)
            }
        } else if let Some(colon_idx) = host_port.rfind(':') {
            // Check if it's host:port or raw unbracketed IPv6
            let maybe_port = &host_port[colon_idx + 1..];
            if let Ok(p) = maybe_port.parse::<u16>() {
                // Ensure there isn't another colon earlier (which would be unbracketed IPv6)
                if !host_port[..colon_idx].contains(':') {
                    (&host_port[..colon_idx], p)
                } else {
                    (host_port, 80)
                }
            } else {
                (host_port, 80)
            }
        } else {
            (host_port, 80)
        };

        if host.is_empty() {
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

        let timeout = Duration::from_secs(self.timeout_secs.min(MAX_TIMEOUT_SECS));

        // Resolve socket address
        let addrs_iter = match format!("{host}:{port}").to_socket_addrs() {
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
                    limitation: Some("TLS timing unavailable".to_string()),
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
                    limitation: Some("TLS timing unavailable".to_string()),
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
                    limitation: Some("TLS timing unavailable".to_string()),
                    source: "live".to_string(),
                });
            }
        };
        let connect_ms = connect_start.elapsed().as_secs_f32() * 1000.0;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        // Send HTTP Request
        let req_str = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: NetPlus-Diagnostics/1.0\r\nConnection: close\r\nAccept: */*\r\n\r\n"
        );

        let ttfb_start = Instant::now();
        if let Err(e) = stream.write_all(req_str.as_bytes()) {
            return Ok(HttpProbeOutput {
                url: self.url.clone(),
                status_code: None,
                connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                ttfb_ms: None,
                transfer_ms: None,
                tls_ms: None,
                error: Some(format!("Failed to write HTTP request: {e}")),
                limitation: Some("TLS timing unavailable".to_string()),
                source: "live".to_string(),
            });
        }

        // Read first chunk (TTFB)
        let mut buffer = [0u8; 4096];
        let first_read = match stream.read(&mut buffer) {
            Ok(0) => {
                return Ok(HttpProbeOutput {
                    url: self.url.clone(),
                    status_code: None,
                    connect_ms: Some((connect_ms * 10.0).round() / 10.0),
                    ttfb_ms: None,
                    transfer_ms: None,
                    tls_ms: None,
                    error: Some("Server closed connection without response".to_string()),
                    limitation: Some("TLS timing unavailable".to_string()),
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
                    tls_ms: None,
                    error: Some(format!("Failed reading response: {e}")),
                    limitation: Some("TLS timing unavailable".to_string()),
                    source: "live".to_string(),
                });
            }
        };
        let ttfb_ms = ttfb_start.elapsed().as_secs_f32() * 1000.0;

        // Parse HTTP status code from initial chunk
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut response = httparse::Response::new(&mut headers);
        let status_code = match response.parse(&buffer[..first_read]) {
            Ok(httparse::Status::Complete(_)) | Ok(httparse::Status::Partial) => response.code,
            Err(_) => None,
        };

        // Read remaining response up to MAX_RESPONSE_BYTES
        let transfer_start = Instant::now();
        let mut total_bytes = first_read;
        while total_bytes < MAX_RESPONSE_BYTES {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => total_bytes += n,
                Err(_) => break,
            }
        }
        let transfer_ms = transfer_start.elapsed().as_secs_f32() * 1000.0;

        Ok(HttpProbeOutput {
            url: self.url.clone(),
            status_code,
            connect_ms: Some((connect_ms * 10.0).round() / 10.0),
            ttfb_ms: Some((ttfb_ms * 10.0).round() / 10.0),
            transfer_ms: Some((transfer_ms * 10.0).round() / 10.0),
            tls_ms: None,
            error: None,
            limitation: Some("TLS timing unavailable".to_string()),
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
        let cancel = AtomicBool::new(false);
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
    fn test_http_probe_connection_refused() {
        // Connect to a closed port on localhost
        let probe = HttpProbe::new("http://127.0.0.1:59999".to_string());
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("http probe run");

        assert_eq!(out.source, "live");
        assert!(out.error.is_some());
        assert!(out.status_code.is_none());
        assert!(out.connect_ms.is_none());
    }

    #[test]
    fn test_http_probe_bracketed_ipv6() {
        let probe = HttpProbe::new("http://[::1]:59999/status".to_string());
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("http probe run");
        assert_eq!(out.source, "live");
        assert!(out.error.is_some());
    }
}
