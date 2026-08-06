//! A minimal, dependency-free reader for the classic **pcap** file format
//! (: replayable fixtures; §13: the file-based path also powers pcap
//! import). This is the byte source for the file-based [`crate::FileCapture`],
//! which lets the *entire* pipeline run deterministically in CI without live
//! capture or privileges.
//!
//! Only the parts NetPulse needs are parsed: the global header (to learn the
//! link type and timestamp precision) and per-record headers (to recover
//! capture-time timestamps . Malformed input yields a clean error,
//! never a panic — this file, too, is fuzz-worthy input.

use netpulse_core::{NpError, Result};
use netpulse_decode::LinkType;

const MAGIC_MICROS_LE: u32 = 0xa1b2c3d4;
const MAGIC_MICROS_BE: u32 = 0xd4c3b2a1;
const MAGIC_NANOS_LE: u32 = 0xa1b23c4d;
const MAGIC_NANOS_BE: u32 = 0x4d3cb2a1;

// Selected libpcap link-layer types (DLT / LINKTYPE).
const LINKTYPE_NULL: u32 = 0;
const LINKTYPE_ETHERNET: u32 = 1;
const LINKTYPE_RAW: u32 = 101;
const LINKTYPE_LINUX_SLL: u32 = 113;

/// One captured record: a capture timestamp plus the raw frame bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PcapRecord {
    /// Seconds since the Unix epoch (wall-clock).
    pub ts_secs: u64,
    /// Sub-second fraction in nanoseconds.
    pub ts_nanos: u32,
    /// The captured frame (possibly snap-length truncated).
    pub data: Vec<u8>,
    /// Original on-wire length; if greater than `data.len()`, the frame was
    /// truncated by the snap length.
    pub orig_len: u32,
}

/// A parsed pcap file: its link type and all records, ready to feed capture.
#[derive(Debug, Clone)]
pub struct PcapFile {
    pub link_type: LinkType,
    pub records: Vec<PcapRecord>,
}

impl PcapFile {
    /// Parse a whole pcap file from memory. Handles both byte orders and both
    /// microsecond and nanosecond timestamp precisions.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 24 {
            return Err(NpError::Decode(
                "pcap: file shorter than global header".into(),
            ));
        }
        let magic = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        let (big_endian, nanos) = match magic {
            MAGIC_MICROS_LE => (false, false),
            MAGIC_NANOS_LE => (false, true),
            MAGIC_MICROS_BE => (true, false),
            MAGIC_NANOS_BE => (true, true),
            other => {
                return Err(NpError::Decode(format!(
                    "pcap: unrecognized magic 0x{other:08x}"
                )))
            }
        };
        let rd32 = |b: &[u8]| -> u32 {
            let a = [b[0], b[1], b[2], b[3]];
            if big_endian {
                u32::from_be_bytes(a)
            } else {
                u32::from_le_bytes(a)
            }
        };

        let network = rd32(&bytes[20..24]);
        let link_type = match network {
            LINKTYPE_ETHERNET => LinkType::Ethernet,
            LINKTYPE_NULL => LinkType::Loopback,
            LINKTYPE_RAW => LinkType::RawIp,
            LINKTYPE_LINUX_SLL => LinkType::Ethernet, // approximated; SLL ~ eth-ish
            other => {
                return Err(NpError::Decode(format!(
                    "pcap: unsupported link type {other}"
                )))
            }
        };

        let mut records = Vec::new();
        let mut pos = 24usize;
        while pos + 16 <= bytes.len() {
            let ts_sec = rd32(&bytes[pos..pos + 4]) as u64;
            let ts_frac = rd32(&bytes[pos + 4..pos + 8]);
            let incl_len = rd32(&bytes[pos + 8..pos + 12]) as usize;
            let orig_len = rd32(&bytes[pos + 12..pos + 16]);
            pos += 16;
            if pos + incl_len > bytes.len() {
                return Err(NpError::Decode(
                    "pcap: record claims more bytes than the file holds".into(),
                ));
            }
            let data = bytes[pos..pos + incl_len].to_vec();
            pos += incl_len;
            let ts_nanos = if nanos { ts_frac } else { ts_frac * 1000 };
            records.push(PcapRecord {
                ts_secs: ts_sec,
                ts_nanos,
                data,
                orig_len,
            });
        }
        Ok(Self { link_type, records })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal little-endian, microsecond pcap with one Ethernet record.
    fn tiny_pcap(frame: &[u8]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&MAGIC_MICROS_LE.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes()); // version major
        b.extend_from_slice(&4u16.to_le_bytes()); // version minor
        b.extend_from_slice(&0i32.to_le_bytes()); // thiszone
        b.extend_from_slice(&0u32.to_le_bytes()); // sigfigs
        b.extend_from_slice(&65535u32.to_le_bytes()); // snaplen
        b.extend_from_slice(&LINKTYPE_ETHERNET.to_le_bytes()); // network
                                                               // record header
        b.extend_from_slice(&1_700_000_000u32.to_le_bytes()); // ts sec
        b.extend_from_slice(&500_000u32.to_le_bytes()); // ts usec
        b.extend_from_slice(&(frame.len() as u32).to_le_bytes()); // incl_len
        b.extend_from_slice(&(frame.len() as u32).to_le_bytes()); // orig_len
        b.extend_from_slice(frame);
        b
    }

    #[test]
    fn parses_single_record() {
        let frame = [0xde, 0xad, 0xbe, 0xef];
        let pcap = PcapFile::parse(&tiny_pcap(&frame)).unwrap();
        assert_eq!(pcap.link_type, LinkType::Ethernet);
        assert_eq!(pcap.records.len(), 1);
        let r = &pcap.records[0];
        assert_eq!(r.ts_secs, 1_700_000_000);
        assert_eq!(r.ts_nanos, 500_000_000); // 500_000 us -> ns
        assert_eq!(r.data, frame);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut bytes = tiny_pcap(&[0u8; 4]);
        bytes[0] = 0x00;
        assert!(PcapFile::parse(&bytes).is_err());
    }

    #[test]
    fn rejects_truncated_record() {
        let mut bytes = tiny_pcap(&[1, 2, 3, 4, 5, 6]);
        bytes.truncate(bytes.len() - 3); // chop the frame
        assert!(PcapFile::parse(&bytes).is_err());
    }

    #[test]
    fn short_file_is_error() {
        assert!(PcapFile::parse(&[0u8; 10]).is_err());
    }
}
