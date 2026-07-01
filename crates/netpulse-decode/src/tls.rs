//! TLS handshake dissection (docs/07 §6.6) — where the "explain encryption"
//! mandate lives. Everything here is read **in the clear**: TLS never decrypts
//! (docs/01 X2). From the ClientHello we extract SNI (which site) and ALPN
//! (which HTTP version); from the ServerHello we note the handshake progressing.
//!
//! The parser is strictly bounded via [`Reader`] and additionally caps the
//! extension walk, so a malformed record cannot loop or over-read (docs/07 §8).

use netpulse_core::Result;

use crate::frame::TlsInfo;
use crate::reader::Reader;

const CONTENT_HANDSHAKE: u8 = 22;
const HS_CLIENT_HELLO: u8 = 1;
const HS_SERVER_HELLO: u8 = 2;
const EXT_SNI: u16 = 0;
const EXT_ALPN: u16 = 16;
const MAX_EXTENSIONS: u32 = 64;

/// Attempt to dissect a TLS record's handshake message from a TCP payload.
/// Returns `None` when the bytes are not a TLS handshake record.
pub fn dissect(payload: &[u8]) -> Result<Option<TlsInfo>> {
    let mut r = Reader::new(payload);
    let content_type = match r.u8() {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    if content_type != CONTENT_HANDSHAKE {
        return Ok(None);
    }
    let _version = r.u16()?; // record-layer version, legacy
    let record_len = r.u16()? as usize;
    // Body is bounded by the record length or what's present, whichever is less.
    let body = r.rest();
    let body = &body[..body.len().min(record_len)];

    let mut hs = Reader::new(body);
    let hs_type = match hs.u8() {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    // 24-bit handshake length.
    let len_hi = hs.u8()? as usize;
    let len_lo = hs.u16()? as usize;
    let hs_len = (len_hi << 16) | len_lo;
    let hs_body = hs.rest();
    let hs_body = &hs_body[..hs_body.len().min(hs_len)];

    match hs_type {
        HS_CLIENT_HELLO => Ok(Some(parse_client_hello(hs_body)?)),
        HS_SERVER_HELLO => Ok(Some(TlsInfo {
            is_server_hello: true,
            ..TlsInfo::default()
        })),
        _ => Ok(None),
    }
}

fn parse_client_hello(body: &[u8]) -> Result<TlsInfo> {
    let mut info = TlsInfo {
        is_client_hello: true,
        ..TlsInfo::default()
    };
    let mut r = Reader::new(body);
    // legacy_version(2) + random(32)
    if r.u16().is_err() || r.skip(32).is_err() {
        return Ok(info); // partial: it's a ClientHello, just truncated
    }
    // session_id
    if let Ok(sid_len) = r.u8() {
        if r.skip(sid_len as usize).is_err() {
            return Ok(info);
        }
    }
    // cipher_suites
    if let Ok(cs_len) = r.u16() {
        if r.skip(cs_len as usize).is_err() {
            return Ok(info);
        }
    }
    // compression_methods
    if let Ok(cm_len) = r.u8() {
        if r.skip(cm_len as usize).is_err() {
            return Ok(info);
        }
    }
    // extensions
    let ext_total = match r.u16() {
        Ok(v) => v as usize,
        Err(_) => return Ok(info),
    };
    let ext_bytes = r.rest();
    let ext_bytes = &ext_bytes[..ext_bytes.len().min(ext_total)];
    parse_extensions(ext_bytes, &mut info);
    Ok(info)
}

fn parse_extensions(bytes: &[u8], info: &mut TlsInfo) {
    let mut r = Reader::new(bytes);
    let mut count = 0u32;
    while r.remaining() >= 4 {
        count += 1;
        if count > MAX_EXTENSIONS {
            break;
        }
        let ext_type = match r.u16() {
            Ok(v) => v,
            Err(_) => break,
        };
        let ext_len = match r.u16() {
            Ok(v) => v as usize,
            Err(_) => break,
        };
        let data = match r.take(ext_len) {
            Ok(d) => d,
            Err(_) => break,
        };
        match ext_type {
            EXT_SNI => {
                if let Some(name) = parse_sni(data) {
                    info.sni = Some(name);
                }
            }
            EXT_ALPN => parse_alpn(data, info),
            _ => {}
        }
    }
}

fn parse_sni(data: &[u8]) -> Option<String> {
    let mut r = Reader::new(data);
    let _list_len = r.u16().ok()?;
    let name_type = r.u8().ok()?;
    if name_type != 0 {
        return None; // 0 = host_name
    }
    let name_len = r.u16().ok()? as usize;
    let name = r.take(name_len).ok()?;
    std::str::from_utf8(name).ok().map(|s| s.to_string())
}

fn parse_alpn(data: &[u8], info: &mut TlsInfo) {
    let mut r = Reader::new(data);
    if r.u16().is_err() {
        return; // ALPN protocol list length
    }
    while r.remaining() > 0 {
        let len = match r.u8() {
            Ok(v) => v as usize,
            Err(_) => break,
        };
        match r.take(len) {
            Ok(p) => {
                if let Ok(s) = std::str::from_utf8(p) {
                    info.alpn.push(s.to_string());
                }
            }
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client_hello_with_sni(host: &str) -> Vec<u8> {
        // Build extensions: SNI + ALPN(h2)
        let mut sni_ext = Vec::new();
        let server_name = host.as_bytes();
        let name_entry_len = 1 + 2 + server_name.len(); // type + len + host
        sni_ext.extend_from_slice(&(name_entry_len as u16).to_be_bytes()); // server_name_list len
        sni_ext.push(0); // host_name
        sni_ext.extend_from_slice(&(server_name.len() as u16).to_be_bytes());
        sni_ext.extend_from_slice(server_name);

        let mut alpn_ext = Vec::new();
        let proto = b"h2";
        let list_len = 1 + proto.len();
        alpn_ext.extend_from_slice(&(list_len as u16).to_be_bytes());
        alpn_ext.push(proto.len() as u8);
        alpn_ext.extend_from_slice(proto);

        let mut exts = Vec::new();
        exts.extend_from_slice(&EXT_SNI.to_be_bytes());
        exts.extend_from_slice(&(sni_ext.len() as u16).to_be_bytes());
        exts.extend_from_slice(&sni_ext);
        exts.extend_from_slice(&EXT_ALPN.to_be_bytes());
        exts.extend_from_slice(&(alpn_ext.len() as u16).to_be_bytes());
        exts.extend_from_slice(&alpn_ext);

        let mut ch = Vec::new();
        ch.extend_from_slice(&[0x03, 0x03]); // legacy_version TLS1.2
        ch.extend_from_slice(&[0u8; 32]); // random
        ch.push(0); // session id len
        ch.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]); // cipher suites (1)
        ch.extend_from_slice(&[0x01, 0x00]); // compression: null
        ch.extend_from_slice(&(exts.len() as u16).to_be_bytes());
        ch.extend_from_slice(&exts);

        // handshake header
        let mut hs = vec![HS_CLIENT_HELLO];
        let l = ch.len();
        hs.push((l >> 16) as u8);
        hs.extend_from_slice(&(l as u16).to_be_bytes());
        hs.extend_from_slice(&ch);

        // record header
        let mut rec = vec![CONTENT_HANDSHAKE, 0x03, 0x01];
        rec.extend_from_slice(&(hs.len() as u16).to_be_bytes());
        rec.extend_from_slice(&hs);
        rec
    }

    #[test]
    fn extracts_sni_and_alpn() {
        let rec = client_hello_with_sni("www.example.com");
        let info = dissect(&rec).unwrap().unwrap();
        assert!(info.is_client_hello);
        assert_eq!(info.sni.as_deref(), Some("www.example.com"));
        assert_eq!(info.alpn, vec!["h2".to_string()]);
    }

    #[test]
    fn non_tls_rejected() {
        assert!(dissect(&[0x47, 0x45, 0x54]).unwrap().is_none()); // "GET"
    }

    #[test]
    fn truncated_client_hello_is_partial_not_panic() {
        let mut rec = client_hello_with_sni("example.com");
        rec.truncate(10);
        // Should not panic; returns Some(partial) or None, never an over-read.
        let _ = dissect(&rec);
    }
}
