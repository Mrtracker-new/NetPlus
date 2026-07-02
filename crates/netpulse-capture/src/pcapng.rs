//! A minimal, dependency-free reader **and writer** for the modern **pcapng**
//! file format (docs/22 §3.1). Recordings (docs/22) and pcapng export (docs/23)
//! build on pcapng because it is the interop gold standard: a recording's frame
//! data *is* a valid pcapng file, so export is nearly free and external captures
//! can be imported and replayed (docs/21 §8, docs/23 §5).
//!
//! Only the blocks NetPulse needs are handled — the Section Header Block (SHB,
//! to learn byte order), the Interface Description Block (IDB, to learn link type
//! and timestamp resolution), and the Enhanced Packet Block (EPB, the frames with
//! their capture-time timestamps, docs/05 §6). Simple Packet Blocks are tolerated;
//! everything else is skipped by block length. Like [`crate::pcap`], malformed
//! input yields a clean error or an honest truncation boundary, never a panic —
//! a recording, too, is fuzz-worthy input (docs/22 §11).

use netpulse_core::{NpError, Result};
use netpulse_decode::LinkType;

use crate::pcap::PcapRecord;

const BT_SHB: u32 = 0x0A0D_0D0A;
const BT_IDB: u32 = 0x0000_0001;
const BT_SPB: u32 = 0x0000_0003;
const BT_EPB: u32 = 0x0000_0006;
/// The byte-order magic in the SHB. Read big- or little-endian to decide.
const BOM: u32 = 0x1A2B_3C4D;

/// The `if_tsresol` interface option code (docs: pcapng §4.2). Its one-byte value
/// selects the timestamp resolution; we write nanoseconds (`9` → 10⁻⁹ s).
const OPT_IF_TSRESOL: u16 = 9;
const OPT_ENDOFOPT: u16 = 0;

// libpcap link-layer type numbers, mirroring `crate::pcap`.
const LINKTYPE_NULL: u16 = 0;
const LINKTYPE_ETHERNET: u16 = 1;
const LINKTYPE_RAW: u16 = 101;

/// A parsed pcapng file: its link type and all records, plus whether parsing hit
/// a truncation boundary (docs/22 §8 corrupt/truncated recovery).
#[derive(Debug, Clone)]
pub struct PcapngFile {
    pub link_type: LinkType,
    pub records: Vec<PcapRecord>,
    /// True when a block ran past the end of the buffer and parsing stopped at
    /// the last valid record rather than erroring — an honest boundary, not a
    /// silent loss (docs/22 §8, mirrors docs/08 §9 recovery).
    pub truncated: bool,
}

fn linktype_num(link: LinkType) -> u16 {
    match link {
        LinkType::Ethernet => LINKTYPE_ETHERNET,
        LinkType::Loopback => LINKTYPE_NULL,
        LinkType::RawIp => LINKTYPE_RAW,
    }
}

fn linktype_from_num(n: u16) -> Result<LinkType> {
    match n {
        LINKTYPE_ETHERNET => Ok(LinkType::Ethernet),
        LINKTYPE_NULL => Ok(LinkType::Loopback),
        LINKTYPE_RAW => Ok(LinkType::RawIp),
        other => Err(NpError::Decode(format!(
            "pcapng: unsupported link type {other}"
        ))),
    }
}

/// Serialize `records` as a little-endian pcapng file with nanosecond timestamp
/// resolution (docs/22 §3.1). The output is a single section: SHB, one IDB for
/// `link_type`, then one EPB per record — a valid capture other tools can open
/// (docs/23 §11 interop).
pub fn write(link_type: LinkType, records: &[PcapRecord]) -> Vec<u8> {
    let mut out = Vec::new();
    write_shb(&mut out);
    write_idb(&mut out, linktype_num(link_type));
    for r in records {
        write_epb(&mut out, r);
    }
    out
}

/// Push a length-prefixed block: `[type][total_len][body...][total_len]`, padding
/// the body to a 32-bit boundary as the format requires.
fn push_block(out: &mut Vec<u8>, block_type: u32, body: &[u8]) {
    let padded = (body.len() + 3) & !3;
    let total = 12 + padded as u32;
    out.extend_from_slice(&block_type.to_le_bytes());
    out.extend_from_slice(&total.to_le_bytes());
    out.extend_from_slice(body);
    out.extend(std::iter::repeat_n(0u8, padded - body.len()));
    out.extend_from_slice(&total.to_le_bytes());
}

fn write_shb(out: &mut Vec<u8>) {
    let mut body = Vec::new();
    body.extend_from_slice(&BOM.to_le_bytes());
    body.extend_from_slice(&1u16.to_le_bytes()); // major
    body.extend_from_slice(&0u16.to_le_bytes()); // minor
    body.extend_from_slice(&(-1i64).to_le_bytes()); // section length: unknown
    push_block(out, BT_SHB, &body);
}

fn write_idb(out: &mut Vec<u8>, linktype: u16) {
    let mut body = Vec::new();
    body.extend_from_slice(&linktype.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes()); // reserved
    body.extend_from_slice(&0u32.to_le_bytes()); // snaplen: 0 = no limit
                                                 // if_tsresol = 9 → nanoseconds.
    body.extend_from_slice(&OPT_IF_TSRESOL.to_le_bytes());
    body.extend_from_slice(&1u16.to_le_bytes());
    body.push(9);
    body.extend_from_slice(&[0, 0, 0]); // pad option value to 4 bytes
    body.extend_from_slice(&OPT_ENDOFOPT.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes());
    push_block(out, BT_IDB, &body);
}

fn write_epb(out: &mut Vec<u8>, r: &PcapRecord) {
    let wall_nanos = r.ts_secs.saturating_mul(1_000_000_000) + r.ts_nanos as u64;
    let mut body = Vec::new();
    body.extend_from_slice(&0u32.to_le_bytes()); // interface id 0
    body.extend_from_slice(&((wall_nanos >> 32) as u32).to_le_bytes()); // ts high
    body.extend_from_slice(&((wall_nanos & 0xFFFF_FFFF) as u32).to_le_bytes()); // ts low
    body.extend_from_slice(&(r.data.len() as u32).to_le_bytes()); // captured len
    body.extend_from_slice(&r.orig_len.to_le_bytes()); // original len
    body.extend_from_slice(&r.data);
    // Packet data is padded to 32 bits inside the block body.
    let pad = ((r.data.len() + 3) & !3) - r.data.len();
    body.extend(std::iter::repeat_n(0u8, pad));
    push_block(out, BT_EPB, &body);
}

/// Parse a whole pcapng file from memory (docs/22 §3.1). Handles both byte orders
/// and the `if_tsresol` timestamp resolution; unknown blocks are skipped by their
/// length. A block that overruns the buffer stops parsing at the last valid record
/// with `truncated = true` (docs/22 §8).
pub fn parse(bytes: &[u8]) -> Result<PcapngFile> {
    if bytes.len() < 12 {
        return Err(NpError::Decode("pcapng: shorter than one block".into()));
    }
    // The first block must be an SHB; its BOM tells us the byte order.
    let first_type = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if first_type != BT_SHB {
        return Err(NpError::Decode(
            "pcapng: missing section header block".into(),
        ));
    }
    if bytes.len() < 24 {
        return Err(NpError::Decode("pcapng: truncated section header".into()));
    }
    let bom_le = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    let big_endian = match bom_le {
        BOM => false,
        x if x.swap_bytes() == BOM => true,
        _ => return Err(NpError::Decode("pcapng: bad byte-order magic".into())),
    };
    let rd32 = |b: &[u8]| -> u32 {
        let a = [b[0], b[1], b[2], b[3]];
        if big_endian {
            u32::from_be_bytes(a)
        } else {
            u32::from_le_bytes(a)
        }
    };
    let rd16 = |b: &[u8]| -> u16 {
        let a = [b[0], b[1]];
        if big_endian {
            u16::from_be_bytes(a)
        } else {
            u16::from_le_bytes(a)
        }
    };

    let mut link_type: Option<LinkType> = None;
    let mut nanos_per_unit: u64 = 1000; // pcapng default resolution is 10⁻⁶ s
    let mut records = Vec::new();
    let mut truncated = false;
    let mut pos = 0usize;

    while pos + 12 <= bytes.len() {
        let btype = rd32(&bytes[pos..pos + 4]);
        let total = rd32(&bytes[pos + 4..pos + 8]) as usize;
        // A well-formed block is at least 12 bytes and 32-bit aligned.
        if total < 12 || !total.is_multiple_of(4) || pos + total > bytes.len() {
            truncated = true;
            break;
        }
        let body = &bytes[pos + 8..pos + total - 4];
        match btype {
            BT_SHB => { /* already validated; nested sections reuse endianness */ }
            BT_IDB => {
                if body.len() < 8 {
                    truncated = true;
                    break;
                }
                link_type = Some(linktype_from_num(rd16(&body[0..2]))?);
                if let Some(res) = parse_tsresol(&body[8..], rd16) {
                    nanos_per_unit = res;
                }
            }
            BT_EPB => {
                if let Some(rec) = parse_epb(body, nanos_per_unit, rd32) {
                    records.push(rec);
                } else {
                    truncated = true;
                    break;
                }
            }
            BT_SPB => {
                if let Some(rec) = parse_spb(body, rd32) {
                    records.push(rec);
                }
            }
            _ => { /* unknown block: skip by length */ }
        }
        pos += total;
    }

    let link_type =
        link_type.ok_or_else(|| NpError::Decode("pcapng: no interface description".into()))?;
    Ok(PcapngFile {
        link_type,
        records,
        truncated,
    })
}

/// Read the `if_tsresol` option from an IDB option area, returning nanoseconds
/// per timestamp unit. Absent/negative-exponent forms are handled honestly.
fn parse_tsresol(mut opts: &[u8], rd16: impl Fn(&[u8]) -> u16) -> Option<u64> {
    while opts.len() >= 4 {
        let code = rd16(&opts[0..2]);
        let len = rd16(&opts[2..4]) as usize;
        if code == OPT_ENDOFOPT {
            return None;
        }
        let padded = (len + 3) & !3;
        if 4 + len > opts.len() {
            return None;
        }
        if code == OPT_IF_TSRESOL && len >= 1 {
            let v = opts[4];
            return Some(if v & 0x80 != 0 {
                // 2^-(v&0x7f) seconds; nanos-per-unit = 1e9 / 2^exp (>=1).
                let exp = (v & 0x7f) as u32;
                (1_000_000_000f64 / 2f64.powi(exp as i32)).max(1.0) as u64
            } else {
                // 10^-v seconds; nanos-per-unit = 1e9 / 10^v.
                let denom = 10u64.saturating_pow(v as u32);
                (1_000_000_000u64 / denom.max(1)).max(1)
            });
        }
        if 4 + padded > opts.len() {
            return None;
        }
        opts = &opts[4 + padded..];
    }
    None
}

fn parse_epb(body: &[u8], nanos_per_unit: u64, rd32: impl Fn(&[u8]) -> u32) -> Option<PcapRecord> {
    if body.len() < 20 {
        return None;
    }
    let ts_high = rd32(&body[4..8]) as u64;
    let ts_low = rd32(&body[8..12]) as u64;
    let cap_len = rd32(&body[12..16]) as usize;
    let orig_len = rd32(&body[16..20]);
    if 20 + cap_len > body.len() {
        return None;
    }
    let data = body[20..20 + cap_len].to_vec();
    let units = (ts_high << 32) | ts_low;
    let wall_nanos = units.saturating_mul(nanos_per_unit);
    Some(PcapRecord {
        ts_secs: wall_nanos / 1_000_000_000,
        ts_nanos: (wall_nanos % 1_000_000_000) as u32,
        data,
        orig_len,
    })
}

fn parse_spb(body: &[u8], rd32: impl Fn(&[u8]) -> u32) -> Option<PcapRecord> {
    if body.len() < 4 {
        return None;
    }
    let orig_len = rd32(&body[0..4]);
    // A Simple Packet Block carries no timestamp; record it at t=0 honestly.
    let cap = (body.len() - 4).min(orig_len as usize);
    Some(PcapRecord {
        ts_secs: 0,
        ts_nanos: 0,
        data: body[4..4 + cap].to_vec(),
        orig_len,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(secs: u64, nanos: u32, data: &[u8]) -> PcapRecord {
        PcapRecord {
            ts_secs: secs,
            ts_nanos: nanos,
            data: data.to_vec(),
            orig_len: data.len() as u32,
        }
    }

    #[test]
    fn round_trips_frames_and_timestamps() {
        let records = vec![
            rec(1_700_000_000, 500_000_000, &[0xde, 0xad, 0xbe, 0xef]),
            rec(1_700_000_001, 250_000_000, &[1, 2, 3]), // unaligned length
        ];
        let bytes = write(LinkType::Ethernet, &records);
        let parsed = parse(&bytes).unwrap();
        assert_eq!(parsed.link_type, LinkType::Ethernet);
        assert!(!parsed.truncated);
        assert_eq!(parsed.records, records);
    }

    #[test]
    fn nanosecond_resolution_is_preserved() {
        // 987_654_321 ns must survive the write→read round trip exactly.
        let records = vec![rec(42, 987_654_321, &[0])];
        let parsed = parse(&write(LinkType::Loopback, &records)).unwrap();
        assert_eq!(parsed.records[0].ts_nanos, 987_654_321);
        assert_eq!(parsed.link_type, LinkType::Loopback);
    }

    #[test]
    fn rejects_missing_section_header() {
        let mut bytes = write(LinkType::Ethernet, &[rec(1, 0, &[9])]);
        bytes[0] ^= 0xFF; // corrupt the SHB block type
        assert!(parse(&bytes).is_err());
    }

    #[test]
    fn truncation_stops_at_last_valid_record() {
        let records = vec![rec(1, 0, &[1, 2, 3, 4]), rec(2, 0, &[5, 6, 7, 8])];
        let mut bytes = write(LinkType::Ethernet, &records);
        bytes.truncate(bytes.len() - 6); // chop into the last EPB
        let parsed = parse(&bytes).unwrap();
        assert!(parsed.truncated);
        assert_eq!(parsed.records.len(), 1); // first frame survives, boundary honest
    }

    #[test]
    fn short_file_is_error() {
        assert!(parse(&[0u8; 8]).is_err());
    }
}
