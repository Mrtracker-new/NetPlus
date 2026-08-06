//! Plaintext HTTP/1.1 dissection. Most HTTP rides inside TLS;
//! this fires only on cleartext (port 80 or an opt-in decrypt path). It extracts
//! the request line (method/path/host) or the status line — feeding the website
//! journey. Header-body reassembly across TCP segments is out of scope
//! for the per-packet pass; we read what a single
//! packet's leading bytes reveal.

use crate::frame::HttpInfo;

const METHODS: &[&str] = &[
    "GET ", "POST ", "PUT ", "HEAD ", "DELETE ", "PATCH ", "OPTIONS ", "TRACE ", "CONNECT ",
];

/// Attempt to recognize the start of an HTTP/1.x message in a TCP payload.
/// Returns `None` for anything that is not a plausible HTTP request/response
/// head (so encrypted or binary payloads are left alone).
pub fn dissect(payload: &[u8]) -> Option<HttpInfo> {
    // Only inspect the head; treat the leading bytes as ASCII, lossily.
    let head_len = payload.len().min(2048);
    let text = std::str::from_utf8(&payload[..head_len]).ok()?;
    let mut lines = text.split("\r\n");
    let first = lines.next()?;

    if let Some(rest) = first.strip_prefix("HTTP/") {
        // Response: "HTTP/1.1 200 OK"
        let mut parts = rest.splitn(3, ' ');
        let _version = parts.next()?;
        let status = parts.next()?.parse::<u16>().ok()?;
        if !(100..=599).contains(&status) {
            return None;
        }
        return Some(HttpInfo {
            is_request: false,
            status: Some(status),
            ..HttpInfo::default()
        });
    }

    // Request: must start with a known method to avoid false positives.
    if !METHODS.iter().any(|m| first.starts_with(m)) {
        return None;
    }
    let mut parts = first.splitn(3, ' ');
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let version = parts.next()?;
    if !version.starts_with("HTTP/") {
        return None;
    }
    let mut info = HttpInfo {
        is_request: true,
        method: Some(method),
        path: Some(path),
        ..HttpInfo::default()
    };
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some(host) = line
            .strip_prefix("Host:")
            .or_else(|| line.strip_prefix("host:"))
        {
            info.host = Some(host.trim().to_string());
        }
    }
    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_get_request_with_host() {
        let raw = b"GET /index.html HTTP/1.1\r\nHost: example.com\r\nUser-Agent: x\r\n\r\n";
        let info = dissect(raw).unwrap();
        assert!(info.is_request);
        assert_eq!(info.method.as_deref(), Some("GET"));
        assert_eq!(info.path.as_deref(), Some("/index.html"));
        assert_eq!(info.host.as_deref(), Some("example.com"));
    }

    #[test]
    fn parses_status_line() {
        let raw = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
        let info = dissect(raw).unwrap();
        assert!(!info.is_request);
        assert_eq!(info.status, Some(404));
    }

    #[test]
    fn binary_payload_rejected() {
        assert!(dissect(&[0x16, 0x03, 0x01, 0x00]).is_none());
    }

    #[test]
    fn random_text_without_method_rejected() {
        assert!(dissect(b"hello world\r\n").is_none());
    }
}
