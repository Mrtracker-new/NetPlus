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
const SOCKET_TIMEOUT: Duration = Duration::from_secs(5);

/// Structure representing a parsed HTTP request envelope.
struct ParsedRequest {
    method: String,
    path: String,
    host: Option<String>,
    token: Option<String>,
    origin: Option<String>,
    body: Vec<u8>,
}

/// Spawns the HTTP bridge server thread using an already-bound `TcpListener`.
pub fn spawn_http_bridge_with_listener(
    state: Arc<AppState>,
    listener: TcpListener,
    stop_flag: Arc<AtomicBool>,
) -> JoinHandle<()> {
    // Set non-blocking on listener so accept() can periodically inspect stop_flag
    let _ = listener.set_nonblocking(true);
    // The bound port is what a legitimate `Host` header must match.
    let bridge_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);

    std::thread::Builder::new()
        .name("netpulse-http-bridge".into())
        .spawn(move || {
            while !stop_flag.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let req_state = Arc::clone(&state);
                        std::thread::spawn(move || {
                            handle_connection(stream, &req_state, bridge_port);
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
        .expect("failed to spawn http bridge thread")
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

    Some(spawn_http_bridge_with_listener(state, listener, stop_flag))
}

fn handle_connection(mut stream: TcpStream, state: &AppState, bridge_port: u16) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_nodelay(true);

    let parsed = match read_and_parse_request(&mut stream) {
        Ok(p) => p,
        Err((status, code, msg)) => {
            send_error(&mut stream, status, code, &msg, None);
            return;
        }
    };

    let allowed_origin = resolve_allowed_origin(parsed.origin.as_deref());

    // 0. Host validation. The loopback bind alone is not authentication: any page
    //    that resolves a hostname to 127.0.0.1 can reach this port, so a request
    //    addressed to a non-loopback name is refused before it reaches any route.
    if !host_allowed(parsed.host.as_deref(), bridge_port) {
        send_error(
            &mut stream,
            403,
            "FORBIDDEN_HOST",
            "Host must be a loopback origin (localhost, 127.0.0.1 or ::1)",
            None,
        );
        return;
    }

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
        if !token_matches(&state.bridge_token, parsed.token.as_deref()) {
            send_error(
                &mut stream,
                401,
                "UNAUTHORIZED",
                "X-NetPulse-Token is required; set NETPULSE_BRIDGE_TOKEN to the value the shell logs",
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
        if !token_matches(&state.bridge_token, parsed.token.as_deref()) {
            send_error(
                &mut stream,
                401,
                "UNAUTHORIZED",
                "X-NetPulse-Token is required; set NETPULSE_BRIDGE_TOKEN to the value the shell logs",
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
    let mut is_chunked = false;
    let mut origin = None;
    let mut host = None;
    let mut token = None;

    for h in req.headers.iter() {
        let name_lower = h.name.to_ascii_lowercase();
        if name_lower == "host" {
            host = Some(String::from_utf8_lossy(h.value).trim().to_string());
        } else if name_lower == "x-netpulse-token" {
            token = Some(String::from_utf8_lossy(h.value).trim().to_string());
        } else if name_lower == "content-type" {
            content_type = Some(String::from_utf8_lossy(h.value).to_string());
        } else if name_lower == "content-length" {
            let val_str = String::from_utf8_lossy(h.value);
            if let Ok(len) = val_str.trim().parse::<usize>() {
                content_length = Some(len);
            }
        } else if name_lower == "transfer-encoding" {
            let val_str = String::from_utf8_lossy(h.value).to_ascii_lowercase();
            if val_str.contains("chunked") {
                is_chunked = true;
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

    // For POST requests, enforce Content-Length or Transfer-Encoding: chunked, and Content-Type
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

        let body = if is_chunked {
            read_chunked_body(stream, initial_body)?
        } else {
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
                    return Err((
                        400,
                        "INCOMPLETE_BODY",
                        "Unexpected EOF in request body".into(),
                    ));
                }
                body.extend_from_slice(&temp_buf[..n]);
            }
            body
        };

        Ok(ParsedRequest {
            method,
            path,
            host,
            token,
            origin,
            body,
        })
    } else {
        Ok(ParsedRequest {
            method,
            path,
            host,
            token,
            origin,
            body: initial_body,
        })
    }
}

/// Loopback host names the bridge answers to.
///
/// A request whose `Host` names anything else is refused before routing: without
/// this, a page on the same machine can reach the bridge through any hostname that
/// resolves to `127.0.0.1` (the DNS-rebinding path), and the CORS/origin checks
/// alone would not stop it. When a port is present it must be the bridge's own.
fn host_allowed(host: Option<&str>, bridge_port: u16) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim();
    if host.is_empty() {
        return false;
    }

    // IPv6 literals are bracketed (`[::1]:4040`); everything else splits on the
    // last colon.
    let (name, port) = if let Some(rest) = host.strip_prefix('[') {
        match rest.split_once(']') {
            Some((name, tail)) => (name, tail.strip_prefix(':')),
            None => return false,
        }
    } else {
        match host.rsplit_once(':') {
            Some((name, port)) => (name, Some(port)),
            None => (host, None),
        }
    };

    if let Some(port) = port {
        match port.parse::<u16>() {
            Ok(port) if port == bridge_port => {}
            _ => return false,
        }
    }

    matches!(name, "localhost" | "127.0.0.1" | "::1")
}

/// Compare the request's capability token against the shell's own.
///
/// Constant-time: a caller guessing byte-by-byte learns nothing from latency.
fn token_matches(expected: &str, provided: Option<&str>) -> bool {
    let Some(provided) = provided else {
        return false;
    };
    let expected = expected.as_bytes();
    let provided = provided.as_bytes();
    if expected.len() != provided.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in expected.iter().zip(provided.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

struct ChunkedReader<'a> {
    stream: &'a mut TcpStream,
    buffer: Vec<u8>,
    pos: usize,
}

impl<'a> ChunkedReader<'a> {
    fn new(stream: &'a mut TcpStream, buffer: Vec<u8>) -> Self {
        Self {
            stream,
            buffer,
            pos: 0,
        }
    }

    fn fill_buffer_if_needed(&mut self) -> Result<bool, (u16, &'static str, String)> {
        if self.pos >= self.buffer.len() {
            let mut temp = [0u8; 1024];
            let n = self.stream.read(&mut temp).map_err(|e| {
                (
                    400,
                    "READ_ERROR",
                    format!("Failed to read chunked stream: {e}"),
                )
            })?;
            if n == 0 {
                return Ok(false);
            }
            self.buffer.clear();
            self.buffer.extend_from_slice(&temp[..n]);
            self.pos = 0;
        }
        Ok(true)
    }

    fn read_byte(&mut self) -> Result<u8, (u16, &'static str, String)> {
        if !self.fill_buffer_if_needed()? {
            return Err((
                400,
                "INCOMPLETE_BODY",
                "Unexpected EOF in chunked request".into(),
            ));
        }
        let b = self.buffer[self.pos];
        self.pos += 1;
        Ok(b)
    }

    fn read_line(&mut self) -> Result<String, (u16, &'static str, String)> {
        let mut line_bytes = Vec::new();
        loop {
            let b = self.read_byte()?;
            if b == b'\n' {
                if line_bytes.last() == Some(&b'\r') {
                    line_bytes.pop();
                }
                return String::from_utf8(line_bytes).map_err(|_| {
                    (
                        400,
                        "MALFORMED_CHUNK",
                        "Invalid UTF-8 in chunk header".into(),
                    )
                });
            }
            line_bytes.push(b);
            if line_bytes.len() > 1024 {
                return Err((400, "MALFORMED_CHUNK", "Chunk header line too long".into()));
            }
        }
    }

    fn read_exact(&mut self, dest: &mut [u8]) -> Result<(), (u16, &'static str, String)> {
        let mut offset = 0;
        while offset < dest.len() {
            if !self.fill_buffer_if_needed()? {
                return Err((
                    400,
                    "INCOMPLETE_BODY",
                    "Unexpected EOF in chunk data".into(),
                ));
            }
            let avail = self.buffer.len() - self.pos;
            let to_copy = (dest.len() - offset).min(avail);
            dest[offset..offset + to_copy]
                .copy_from_slice(&self.buffer[self.pos..self.pos + to_copy]);
            self.pos += to_copy;
            offset += to_copy;
        }
        Ok(())
    }
}

fn read_chunked_body(
    stream: &mut TcpStream,
    initial_buffer: Vec<u8>,
) -> Result<Vec<u8>, (u16, &'static str, String)> {
    let mut reader = ChunkedReader::new(stream, initial_buffer);
    let mut body = Vec::new();

    loop {
        let line = reader.read_line()?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let hex_str = trimmed.split(';').next().unwrap_or("").trim();
        let chunk_size = usize::from_str_radix(hex_str, 16).map_err(|_| {
            (
                400,
                "MALFORMED_CHUNK",
                format!("Invalid chunk size '{hex_str}'"),
            )
        })?;

        if chunk_size == 0 {
            // Read trailing headers / CRLF
            loop {
                let trailer = reader.read_line()?;
                if trailer.trim().is_empty() {
                    break;
                }
            }
            break;
        }

        if body.len() + chunk_size > MAX_BODY_BYTES {
            return Err((
                413,
                "PAYLOAD_TOO_LARGE",
                format!("Chunked body exceeds limit of {MAX_BODY_BYTES} bytes"),
            ));
        }

        let start_len = body.len();
        body.resize(start_len + chunk_size, 0);
        reader.read_exact(&mut body[start_len..])?;

        let cr = reader.read_byte()?;
        let lf = reader.read_byte()?;
        if cr != b'\r' || lf != b'\n' {
            return Err((
                400,
                "MALFORMED_CHUNK",
                "Missing CRLF after chunk data".into(),
            ));
        }
    }

    Ok(body)
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
        Ok(result) => {
            // The typed result travels back verbatim (e.g. the export artifact the
            // UI needs to display), so both transports answer the same shape.
            match serde_json::to_string(&result) {
                Ok(json) => send_json_response(stream, 200, &json, allowed_origin),
                Err(e) => send_error(
                    stream,
                    500,
                    "SERIALIZATION_ERROR",
                    &format!("command result could not be serialized: {e}"),
                    allowed_origin,
                ),
            }
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
        401 => "401 Unauthorized",
        403 => "403 Forbidden",
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
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
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
         Access-Control-Allow-Headers: Content-Type, Content-Length, X-NetPulse-Token\r\n\
         Access-Control-Max-Age: 86400\r\n\
         \r\n",
        origin_header
    );

    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
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

    /// The capability token the state under test requires. Tests read it from the
    /// state rather than hard-coding one, so the requirement cannot drift.
    fn token(state: &AppState) -> &str {
        state.bridge_token.as_str()
    }

    fn read_response(client: &mut TcpStream) -> String {
        let mut res = String::new();
        match client.read_to_string(&mut res) {
            Ok(_) => res,
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset && !res.is_empty() => res,
            Err(e) => panic!("Failed to read response: {e}"),
        }
    }

    #[test]
    fn test_http_bridge_health_endpoint() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let req_body = r#"{"kind":"handshake","client_min_version":6,"client_max_version":6}"#;
        let token = token(&state).to_string();
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let req_body = "plain text body";
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n\r\n")
            .unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let oversized_len = MAX_BODY_BYTES + 1024;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            oversized_len
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/command HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"OPTIONS /api/command HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:5173\r\n\r\n")
            .unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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
        assert!(
            res.is_none(),
            "Must fail cleanly and return None on port collision"
        );
    }

    #[test]
    fn test_http_bridge_command_idempotency_and_rejections() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        // 1. Attempt stopCapture while capture is not running
        let req_body = r#"{"kind":"stopCapture","iface_id":0}"#;
        let token = token(&state).to_string();
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/command HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

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

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let huge_padding = "A".repeat(MAX_HEADER_BYTES + 512);
        let request = format!(
            "GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Padding: {}\r\nConnection: close\r\n\r\n",
            huge_padding
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

        assert!(res.contains("HTTP/1.1 431 Request Header Fields Too Large"));
        assert!(res.contains("HEADERS_TOO_LARGE"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_chunked_query() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let chunk1 = r#"{"kind":"handshake","#;
        let chunk2 = r#""client_min_version":6,"client_max_version":6}"#;

        let token = token(&state).to_string();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: {token}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n{:X}\r\n{}\r\n{:X}\r\n{}\r\n0\r\n\r\n",
            chunk1.len(),
            chunk1,
            chunk2.len(),
            chunk2
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

        assert!(res.contains("HTTP/1.1 200 OK"));
        assert!(res.contains("\"kind\":\"handshake\""));
        assert!(res.contains("\"compatible\":true"));

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_command_returns_the_typed_result() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        // A command that completes with nothing to report still answers with its
        // typed result, so both transports return the same shape (and an export
        // would carry its artifact here).
        let token = token(&state).to_string();
        let req_body = r#"{"kind":"setDepth","depth":"beginner"}"#;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/command HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

        assert!(res.contains("HTTP/1.1 200 OK"), "got: {res}");
        assert!(res.contains("\"kind\":\"completed\""), "got: {res}");

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_export_returns_the_artifact_over_http() {
        let _guard = crate::export_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "netpulse_bridge_export_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("NETPULSE_EXPORT_DIR", &dir);

        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        // The browser transport must carry the same artifact the desktop transport
        // returns, otherwise the UI could not show the path in browser mode.
        let token = token(&state).to_string();
        let req_body = r#"{"kind":"startExport","selection":{"kind":"all"},"format":"json","level":"metadata_only"}"#;
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/command HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);

        assert!(res.contains("HTTP/1.1 200 OK"), "got: {res}");
        assert!(res.contains("\"kind\":\"artifactWritten\""), "got: {res}");
        assert!(res.contains("\"format\":\"json\""), "got: {res}");
        // Framing check first: the bytes after the header terminator must be exactly
        // `Content-Length` long, or a browser fetch would receive a corrupt body.
        let header_end = res.find("\r\n\r\n").expect("headers terminated") + 4;
        let content_length: usize = res[..header_end]
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .and_then(|v| v.trim().parse().ok())
            .expect("Content-Length present");
        assert_eq!(
            res.len() - header_end,
            content_length,
            "body length must match Content-Length; full response: {res:?}"
        );
        let body = &res[header_end..];
        let value: serde_json::Value = serde_json::from_str(body)
            .unwrap_or_else(|e| panic!("result body is not JSON ({e}): {body:?}\nfull: {res:?}"));
        let path = value["artifact"]["path"]
            .as_str()
            .expect("artifact path is reported");
        assert!(
            std::path::Path::new(path).is_file(),
            "reported path must exist: {path}"
        );

        stop.store(true, Ordering::Release);
        let _ = handle.join();
        let _ = std::fs::remove_dir_all(&dir);
        std::env::remove_var("NETPULSE_EXPORT_DIR");
    }

    #[test]
    fn test_http_bridge_requires_capability_token() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        let req_body = r#"{"kind":"handshake","client_min_version":6,"client_max_version":6}"#;

        // 1. No token at all → refused, and nothing executed.
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/query HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);
        assert!(res.contains("HTTP/1.1 401 Unauthorized"), "got: {res}");
        assert!(res.contains("UNAUTHORIZED"));
        assert!(!res.contains("\"kind\":\"handshake\""));

        // 2. A wrong token is refused too, on the command route as well.
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!(
            "POST /api/command HTTP/1.1\r\nHost: localhost\r\nX-NetPulse-Token: not-the-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            req_body.len(),
            req_body
        );
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);
        assert!(res.contains("HTTP/1.1 401 Unauthorized"), "got: {res}");

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }

    #[test]
    fn test_http_bridge_rejects_foreign_host() {
        let state = Arc::new(seeded_state());
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle =
            spawn_http_bridge_with_listener(Arc::clone(&state), listener, Arc::clone(&stop));

        // DNS rebinding: a name that resolves to 127.0.0.1 must not be served.
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/health HTTP/1.1\r\nHost: rebind.example.com\r\n\r\n")
            .unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);
        assert!(res.contains("HTTP/1.1 403 Forbidden"), "got: {res}");
        assert!(res.contains("FORBIDDEN_HOST"));

        // A loopback host with the right port is served.
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let request = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
        client.write_all(request.as_bytes()).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        let res = read_response(&mut client);
        assert!(res.contains("HTTP/1.1 200 OK"), "got: {res}");

        stop.store(true, Ordering::Release);
        let _ = handle.join();
    }
}
