//! # Production-Hardened Dual-Transport HTTP Bridge
//!
//! Provides a minimal-dependency, loopback-only HTTP server on `127.0.0.1:4040`
//! (or a configured port) so that local browser sessions (e.g. `http://localhost:5173`)
//! can communicate with the exact same domain execution paths as the native desktop shell.
//!
//! ## Architectural Guarantees:
//! 1. **Single Execution Path**: Zero business logic here; all queries and commands
//!    delegate directly to `execute_query` and `execute_command`.
//! 2. **Bounded Parsing**: Strictly bounded headers (8 KB) and bodies (2 MB).
//!    Zero unbounded reads.
//! 3. **Connection Model**: Strict `Connection: close` per response.
//! 4. **Resilience**: If the port is occupied, desktop execution continues unaffected.
//! 5. **Thread Safety**: Zero unsynchronized mutable state.

use crate::AppState;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub const DEFAULT_HTTP_BRIDGE_PORT: u16 = 4040;
pub const MAX_HEADER_BYTES: usize = 8 * 1024; // 8 KB
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024; // 2 MB
const SOCKET_TIMEOUT: Duration = Duration::from_millis(500);

/// Structure representing a parsed HTTP request envelope.
struct ParsedRequest {
    method: String,
    path: String,
    origin: Option<String>,
    body: Vec<u8>,
}

/// Spawns the HTTP bridge server thread.
/// Returns `Some(JoinHandle)` if bound successfully, or `None` if port binding failed.
pub fn spawn_http_bridge(
    state: Arc<AppState>,
    port: u16,
    stop_flag: Arc<AtomicBool>,
) -> Option<JoinHandle<()>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(addr) {
        Ok(l) => {
            tracing::info!(
                event = "http_bridge.started",
                addr = %addr,
                "HTTP bridge listening for browser transport"
            );
            l
        }
        Err(e) => {
            tracing::error!(
                event = "http_bridge.bind_failed",
                addr = %addr,
                error = %e,
                "HTTP bridge failed to bind 127.0.0.1:{}: port in use or permission denied. Browser mode unavailable; native desktop IPC remains active.",
                port
            );
            return None;
        }
    };

    // Set non-blocking on listener so accept() can periodically inspect stop_flag
    let _ = listener.set_nonblocking(true);

    let handle = std::thread::Builder::new()
        .name("netpulse-http-bridge".into())
        .spawn(move || {
            while !stop_flag.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let req_state = Arc::clone(&state);
                        std::thread::spawn(move || {
                            handle_connection(stream, &req_state);
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
            tracing::info!(
                event = "http_bridge.stopped",
                "HTTP bridge server terminated"
            );
        })
        .ok();

    handle
}

fn handle_connection(mut stream: TcpStream, state: &AppState) {
    let _ = stream.set_read_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));

    let parsed = match read_and_parse_request(&mut stream) {
        Ok(p) => p,
        Err((status, code, msg)) => {
            send_error(&mut stream, status, code, &msg, None);
            return;
        }
    };

    let allowed_origin = resolve_allowed_origin(parsed.origin.as_deref());

    // 1. CORS Preflight
    if parsed.method == "OPTIONS" {
        send_options_response(&mut stream, allowed_origin);
        return;
    }

    // 2. Health check route
    if parsed.path == "/api/health" {
        if parsed.method != "GET" {
            send_error(
                &mut stream,
                405,
                "METHOD_NOT_ALLOWED",
                "GET is required for /api/health",
                allowed_origin,
            );
            return;
        }
        let capture_running = state.capture.lock().map(|g| g.is_some()).unwrap_or(false);
        let resp_json = serde_json::json!({
            "status": "ok",
            "version": "0.1.0",
            "capture_running": capture_running
        });
        send_json_response(&mut stream, 200, &resp_json.to_string(), allowed_origin);
        return;
    }

    // 3. Query route
    if parsed.path == "/api/query" {
        if parsed.method != "POST" {
            send_error(
                &mut stream,
                405,
                "METHOD_NOT_ALLOWED",
                "POST is required for /api/query",
                allowed_origin,
            );
            return;
        }
        validate_and_execute_query(&mut stream, state, &parsed.body, allowed_origin);
        return;
    }

    // 4. Command route
    if parsed.path == "/api/command" {
        if parsed.method != "POST" {
            send_error(
                &mut stream,
                405,
                "METHOD_NOT_ALLOWED",
                "POST is required for /api/command",
                allowed_origin,
            );
            return;
        }
        validate_and_execute_command(&mut stream, state, &parsed.body, allowed_origin);
        return;
    }

    // 5. Unknown route
    send_error(
        &mut stream,
        404,
        "NOT_FOUND",
        &format!("Route '{}' not found", parsed.path),
        allowed_origin,
    );
}

/// Reads from stream enforcing independent header (8KB) and body (2MB) limits.
fn read_and_parse_request(
    stream: &mut TcpStream,
) -> Result<ParsedRequest, (u16, &'static str, String)> {
    let mut header_buf = Vec::with_capacity(1024);
    let mut temp_buf = [0u8; 1024];
    let body_start;

    // Read until headers are complete or MAX_HEADER_BYTES exceeded
    loop {
        let n = stream
            .read(&mut temp_buf)
            .map_err(|_| (400, "READ_ERROR", "Failed to read request stream".into()))?;
        if n == 0 {
            return Err((400, "INCOMPLETE_REQUEST", "Connection closed early".into()));
        }

        header_buf.extend_from_slice(&temp_buf[..n]);

        if header_buf.len() > MAX_HEADER_BYTES {
            return Err((
                431,
                "HEADERS_TOO_LARGE",
                format!("Request headers exceed {MAX_HEADER_BYTES} bytes limit"),
            ));
        }

        let mut headers = [httparse::EMPTY_HEADER; 32];
        let mut req = httparse::Request::new(&mut headers);
        match req.parse(&header_buf) {
            Ok(httparse::Status::Complete(amt)) => {
                if amt > MAX_HEADER_BYTES {
                    return Err((
                        431,
                        "HEADERS_TOO_LARGE",
                        format!("Request headers exceed {MAX_HEADER_BYTES} bytes limit"),
                    ));
                }
                body_start = Some(amt);
                break;
            }
            Ok(httparse::Status::Partial) => {}
            Err(e) => {
                return Err((400, "MALFORMED_HEADERS", format!("Header parse error: {e}")));
            }
        }
    }

    let body_start = body_start.unwrap();
    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut req = httparse::Request::new(&mut headers);
    let _ = req.parse(&header_buf);

    let method = req.method.unwrap_or("").to_ascii_uppercase();
    let path = req.path.unwrap_or("").to_string();

    let mut content_type = None;
    let mut content_length = None;
    let mut origin = None;

    for h in req.headers.iter() {
        let name_lower = h.name.to_ascii_lowercase();
        if name_lower == "content-type" {
            content_type = Some(String::from_utf8_lossy(h.value).to_string());
        } else if name_lower == "content-length" {
            let val_str = String::from_utf8_lossy(h.value);
            if let Ok(len) = val_str.trim().parse::<usize>() {
                content_length = Some(len);
            }
        } else if name_lower == "transfer-encoding" {
            let val_str = String::from_utf8_lossy(h.value).to_ascii_lowercase();
            if val_str.contains("chunked") {
                return Err((
                    501,
                    "NOT_IMPLEMENTED",
                    "Chunked transfer encoding is not supported".into(),
                ));
            }
        } else if name_lower == "origin" {
            origin = Some(String::from_utf8_lossy(h.value).to_string());
        }
    }

    let initial_body = if header_buf.len() > body_start {
        header_buf[body_start..].to_vec()
    } else {
        Vec::new()
    };

    // For POST requests, enforce Content-Length and Content-Type
    if method == "POST" {
        let ct = match content_type.as_deref() {
            Some(ct) => ct.to_ascii_lowercase(),
            None => {
                return Err((
                    415,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "Content-Type must be application/json".into(),
                ))
            }
        };
        if !ct.contains("application/json") {
            return Err((
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "Content-Type must be application/json".into(),
            ));
        }

        let needed_length = match content_length {
            Some(len) => len,
            None => {
                return Err((
                    411,
                    "LENGTH_REQUIRED",
                    "Content-Length header is required for POST requests".into(),
                ))
            }
        };

        if needed_length > MAX_BODY_BYTES {
            return Err((
                413,
                "PAYLOAD_TOO_LARGE",
                format!("Body length {needed_length} exceeds limit of {MAX_BODY_BYTES} bytes"),
            ));
        }

        let mut body = initial_body;
        while body.len() < needed_length {
            let to_read = (needed_length - body.len()).min(temp_buf.len());
            let n = stream
                .read(&mut temp_buf[..to_read])
                .map_err(|_| (400, "READ_ERROR", "Failed to read request body".into()))?;
            if n == 0 {
                return Err((400, "INCOMPLETE_BODY", "Unexpected EOF in request body".into()));
            }
            body.extend_from_slice(&temp_buf[..n]);
        }

        Ok(ParsedRequest {
            method,
            path,
            origin,
            body,
        })
    } else {
        Ok(ParsedRequest {
            method,
            path,
            origin,
            body: initial_body,
        })
    }
}

fn resolve_allowed_origin(request_origin: Option<&str>) -> Option<&'static str> {
    match request_origin {
        Some(o) if o.starts_with("http://localhost:") => Some("http://localhost:5173"),
        Some(o) if o.starts_with("http://127.0.0.1:") => Some("http://127.0.0.1:5173"),
        _ => Some("http://localhost:5173"),
    }
}

fn validate_and_execute_query(
    stream: &mut TcpStream,
    state: &AppState,
    body: &[u8],
    allowed_origin: Option<&str>,
) {
    let query: netpulse_api::Query = match serde_json::from_slice(body) {
        Ok(q) => q,
        Err(e) => {
            send_error(
                stream,
                400,
                "MALFORMED_JSON",
                &format!("Invalid Query JSON: {e}"),
                allowed_origin,
            );
            return;
        }
    };

    match crate::ipc::query::execute_query(state, query) {
        Ok(resp) => {
            let resp_json = match serde_json::to_string(&resp) {
                Ok(j) => j,
                Err(e) => {
                    send_error(
                        stream,
                        500,
                        "SERIALIZATION_ERROR",
                        &format!("Failed to serialize query response: {e}"),
                        allowed_origin,
                    );
                    return;
                }
            };
            send_json_response(stream, 200, &resp_json, allowed_origin);
        }
        Err(e) => {
            send_error(stream, 500, "BACKEND_ERROR", &e, allowed_origin);
        }
    }
}

fn validate_and_execute_command(
    stream: &mut TcpStream,
    state: &AppState,
    body: &[u8],
    allowed_origin: Option<&str>,
) {
    let command: netpulse_api::Command = match serde_json::from_slice(body) {
        Ok(c) => c,
        Err(e) => {
            send_error(
                stream,
                400,
                "MALFORMED_JSON",
                &format!("Invalid Command JSON: {e}"),
                allowed_origin,
            );
            return;
        }
    };

    match crate::ipc::command::execute_command(state, command) {
        Ok(()) => {
            let resp_json = r#"{"status":"ok"}"#;
            send_json_response(stream, 200, resp_json, allowed_origin);
        }
        Err(e) => {
            send_error(stream, 400, "INVALID_REQUEST", &e, allowed_origin);
        }
    }
}

fn send_json_response(
    stream: &mut TcpStream,
    status_code: u16,
    json_body: &str,
    allowed_origin: Option<&str>,
) {
    let status_text = match status_code {
        200 => "200 OK",
        400 => "400 Bad Request",
        404 => "404 Not Found",
        405 => "405 Method Not Allowed",
        411 => "411 Length Required",
        413 => "413 Payload Too Large",
        415 => "415 Unsupported Media Type",
        431 => "431 Request Header Fields Too Large",
        500 => "500 Internal Server Error",
        _ => "500 Internal Server Error",
    };

    let origin_header = match allowed_origin {
        Some(o) => format!("Access-Control-Allow-Origin: {o}\r\n"),
        None => String::new(),
    };

    let response = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         {}\r\n\
         {}",
        status_text,
        json_body.len(),
        origin_header,
        json_body
    );

    let _ = stream.write_all(response.as_bytes());
}

fn send_options_response(stream: &mut TcpStream, allowed_origin: Option<&str>) {
    let origin_header = match allowed_origin {
        Some(o) => format!("Access-Control-Allow-Origin: {o}\r\n"),
        None => String::new(),
    };

    let response = format!(
        "HTTP/1.1 204 No Content\r\n\
         Connection: close\r\n\
         {}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Content-Length\r\n\
         Access-Control-Max-Age: 86400\r\n\
         \r\n",
        origin_header
    );

    let _ = stream.write_all(response.as_bytes());
}

fn send_error(
    stream: &mut TcpStream,
    status_code: u16,
    error_code: &'static str,
    message: &str,
    allowed_origin: Option<&str>,
) {
    let error_body = serde_json::json!({
        "error": {
            "code": error_code,
            "message": message
        }
    })
    .to_string();

    send_json_response(stream, status_code, &error_body, allowed_origin);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::test_support::seeded_state;
    use std::io::Read;

    #[test]
    fn test_http_bridge_health_endpoint() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 200 OK"));
        assert!(res.contains("\"status\":\"ok\""));
        assert!(res.contains("\"capture_running\":false"));
        assert!(res.contains("Content-Type: application/json"));
        assert!(res.contains("Connection: close"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_query_valid() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let req_body = r#"{"kind":"handshake","client_min_version":6,"client_max_version":6}"#;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 200 OK"));
        assert!(res.contains("\"kind\":\"handshake\""));
        assert!(res.contains("\"compatible\":true"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_content_type_validation_415() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let req_body = "plain text body";
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 415 Unsupported Media Type"));
        assert!(res.contains("UNSUPPORTED_MEDIA_TYPE"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_missing_content_length_411() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 411 Length Required"));
        assert!(res.contains("LENGTH_REQUIRED"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_body_too_large_413() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let oversized_len = MAX_BODY_BYTES + 1024;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            oversized_len
        );
        client.write_all(request.as_bytes()).unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 413 Payload Too Large"));
        assert!(res.contains("PAYLOAD_TOO_LARGE"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_method_not_allowed_405() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/command HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 405 Method Not Allowed"));
        assert!(res.contains("METHOD_NOT_ALLOWED"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_options_cors() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"OPTIONS /api/command HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:5173\r\n\r\n")
            .unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 204 No Content"));
        assert!(res.contains("Access-Control-Allow-Origin: http://localhost:5173"));
        assert!(res.contains("Access-Control-Allow-Methods: GET, POST, OPTIONS"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_port_conflict_recovery() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let blocker = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = blocker.local_addr().unwrap().port();

        let res = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop));
        assert!(res.is_none(), "Must fail cleanly and return None on port collision");
    }

    #[test]
    fn test_http_bridge_command_idempotency_and_rejections() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        // 1. Attempt stopCapture while capture is not running
        let req_body = r#"{"kind":"stopCapture","iface_id":0}"#;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/command HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 400 Bad Request"));
        assert!(res.contains("no capture is running"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_header_too_large_431() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let handle = spawn_http_bridge(Arc::clone(&state), port, Arc::clone(&stop)).unwrap();

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let huge_padding = "A".repeat(MAX_HEADER_BYTES + 512);
        let request = format!(
            "GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Padding: {}\r\nConnection: close\r\n\r\n",
            huge_padding
        );
        client.write_all(request.as_bytes()).unwrap();

        let mut res = String::new();
        client.read_to_string(&mut res).unwrap();

        assert!(res.contains("HTTP/1.1 431 Request Header Fields Too Large"));
        assert!(res.contains("HEADERS_TOO_LARGE"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }
}
