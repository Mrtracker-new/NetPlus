//! DNS dissection. DNS is the "what happened after I typed a
//! name" starting point, so it gets careful treatment: queries, responses,
//! answers (A/AAAA/CNAME), and the response code — the raw material for the
//! flow engine's DNS→connection lineage.
//!
//! Name decompression is the classic DoS trap (a pointer loop). The reader is
//! bounds-checked and pointer following is hard-capped, so a
//! crafted packet stops and is flagged rather than looping.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use netpulse_core::Result;

use crate::frame::{DnsAnswer, DnsInfo, DnsQuestion};

const TYPE_A: u16 = 1;
const TYPE_CNAME: u16 = 5;
const TYPE_AAAA: u16 = 28;
const MAX_POINTER_JUMPS: u32 = 16;
const MAX_LABELS: u32 = 128;

/// Parse a DNS message from a UDP payload. Returns `None` when the bytes are not
/// a plausible DNS message (so the caller can keep the flow as generic UDP).
pub fn dissect(msg: &[u8]) -> Result<Option<DnsInfo>> {
    if msg.len() < 12 {
        return Ok(None);
    }
    let flags = u16::from_be_bytes([msg[2], msg[3]]);
    let qr = flags & 0x8000 != 0;
    let opcode = (flags >> 11) & 0x0f;
    if opcode != 0 {
        // Only standard queries are modelled; others are not DNS lineage signal.
        return Ok(None);
    }
    let rcode = (flags & 0x000f) as u8;
    let qdcount = u16::from_be_bytes([msg[4], msg[5]]);
    let ancount = u16::from_be_bytes([msg[6], msg[7]]);

    let mut pos = 12usize;
    let mut questions = Vec::new();
    for _ in 0..qdcount {
        let (name, next) = match read_name(msg, pos) {
            Some(v) => v,
            None => return Ok(None),
        };
        pos = next;
        if pos + 4 > msg.len() {
            return Ok(None);
        }
        let qtype = u16::from_be_bytes([msg[pos], msg[pos + 1]]);
        pos += 4; // qtype + qclass
        questions.push(DnsQuestion { name, qtype });
    }

    let mut answers = Vec::new();
    for _ in 0..ancount {
        let (name, next) = match read_name(msg, pos) {
            Some(v) => v,
            None => break,
        };
        pos = next;
        if pos + 10 > msg.len() {
            break;
        }
        let rtype = u16::from_be_bytes([msg[pos], msg[pos + 1]]);
        let ttl = u32::from_be_bytes([msg[pos + 4], msg[pos + 5], msg[pos + 6], msg[pos + 7]]);
        let rdlength = u16::from_be_bytes([msg[pos + 8], msg[pos + 9]]) as usize;
        pos += 10;
        if pos + rdlength > msg.len() {
            break;
        }
        let rdata = &msg[pos..pos + rdlength];
        let mut answer = DnsAnswer {
            name,
            addr: None,
            cname: None,
            ttl,
        };
        match rtype {
            TYPE_A if rdlength == 4 => {
                answer.addr = Some(IpAddr::V4(Ipv4Addr::new(
                    rdata[0], rdata[1], rdata[2], rdata[3],
                )));
            }
            TYPE_AAAA if rdlength == 16 => {
                let mut b = [0u8; 16];
                b.copy_from_slice(rdata);
                answer.addr = Some(IpAddr::V6(Ipv6Addr::from(b)));
            }
            TYPE_CNAME => {
                if let Some((cname, _)) = read_name(msg, pos) {
                    answer.cname = Some(cname);
                }
            }
            _ => {}
        }
        pos += rdlength;
        answers.push(answer);
    }

    Ok(Some(DnsInfo {
        is_response: qr,
        rcode,
        questions,
        answers,
    }))
}

/// Decode a (possibly compressed) DNS name starting at `start`. Returns the
/// dotted name and the offset just past the name *in the original stream*
/// (following the first pointer, per RFC 1035). Pointer following is capped to
/// defuse compression-loop DoS. Returns `None` on malformed input.
fn read_name(msg: &[u8], start: usize) -> Option<(String, usize)> {
    let mut labels: Vec<&str> = Vec::new();
    let mut pos = start;
    let mut jumps = 0u32;
    let mut label_count = 0u32;
    let mut end_after_pointer: Option<usize> = None;

    loop {
        if pos >= msg.len() {
            return None;
        }
        let len = msg[pos] as usize;
        if len & 0xc0 == 0xc0 {
            // Compression pointer: 2 bytes.
            if pos + 1 >= msg.len() {
                return None;
            }
            if end_after_pointer.is_none() {
                end_after_pointer = Some(pos + 2);
            }
            jumps += 1;
            if jumps > MAX_POINTER_JUMPS {
                return None;
            }
            let ptr = ((len & 0x3f) << 8) | msg[pos + 1] as usize;
            pos = ptr;
            continue;
        }
        if len == 0 {
            pos += 1;
            break;
        }
        label_count += 1;
        if label_count > MAX_LABELS {
            return None;
        }
        let s = pos + 1;
        let e = s + len;
        if e > msg.len() {
            return None;
        }
        labels.push(std::str::from_utf8(&msg[s..e]).ok()?);
        pos = e;
    }

    let name = labels.join(".");
    Some((name, end_after_pointer.unwrap_or(pos)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query_for(name: &str) -> Vec<u8> {
        let mut m = vec![0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        for label in name.split('.') {
            m.push(label.len() as u8);
            m.extend_from_slice(label.as_bytes());
        }
        m.push(0);
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // A, IN
        m
    }

    #[test]
    fn parses_query_name() {
        let info = dissect(&query_for("example.com")).unwrap().unwrap();
        assert!(!info.is_response);
        assert_eq!(info.questions.len(), 1);
        assert_eq!(info.questions[0].name, "example.com");
    }

    #[test]
    fn parses_a_record_response() {
        // Response with one question and one A answer using a compression pointer.
        let mut m = vec![0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0, 0, 0, 0];
        // question: example.com A IN
        for label in ["example", "com"] {
            m.push(label.len() as u8);
            m.extend_from_slice(label.as_bytes());
        }
        m.push(0);
        m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
        // answer: pointer to offset 12, A, IN, ttl 300, rdlen 4, 93.184.216.34
        m.extend_from_slice(&[0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01]);
        m.extend_from_slice(&[0x00, 0x00, 0x01, 0x2c, 0x00, 0x04, 93, 184, 216, 34]);
        let info = dissect(&m).unwrap().unwrap();
        assert!(info.is_response);
        assert_eq!(info.answers.len(), 1);
        assert_eq!(
            info.answers[0].addr,
            Some(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)))
        );
        assert_eq!(info.answers[0].ttl, 300);
    }

    #[test]
    fn compression_loop_terminates() {
        // A name that is a pointer to itself must not hang.
        let mut m = vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        m.extend_from_slice(&[0xc0, 0x0c]); // pointer at offset 12 -> offset 12
        assert!(read_name(&m, 12).is_none());
    }

    #[test]
    fn non_dns_bytes_rejected() {
        assert!(dissect(&[0xff; 4]).unwrap().is_none());
    }
}
