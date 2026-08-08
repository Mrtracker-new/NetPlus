//! Versioned Framed Fleet Transport Protocol & Codec Abstraction.
//!
//! Binary Frame Transport Protocol Specification (12-byte header + binary payload batch):
//! - Header (12 bytes, Little-Endian):
//!   - magic (4 bytes): `*b"NPFL"`
//!   - version (1 byte): `1`
//!   - flags (1 byte): Bit 0 (`0x01`) = `FLAG_STATS_PRESENT`
//!   - reserved (2 bytes): Must be `0`
//!   - payload_len (4 bytes): Little-Endian, max 10MB safety limit
//! - TransportStats (16 bytes, present when `FLAG_STATS_PRESENT` bit is set):
//!   - dropped_frames (8 bytes, u64 LE)
//!   - queue_depth (4 bytes, u32 LE)
//!   - reserved (4 bytes, u32 LE, must be 0)
//! - BinaryFrameBatch:
//!   - batch_seq_num (8 bytes, u64 LE)
//!   - frame_count (4 bytes, u32 LE)
//!   - [stats] (16 bytes, optional)
//!   - frames: Array of frame_count binary frames (seq_num, mono_nanos, iface_id, wire_len, caplen, pkt_data)

use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub const MAGIC_BYTES: [u8; 4] = *b"NPFL";
pub const CURRENT_VERSION: u8 = 1;
pub const FLAG_STATS_PRESENT: u8 = 0x01;
pub const MAX_PAYLOAD_LEN: u32 = 10 * 1024 * 1024; // 10MB safety limit

/// 12-byte fixed-width transport frame header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(C)]
pub struct FrameHeader {
    pub magic: [u8; 4],
    pub version: u8,
    pub flags: u8,
    pub reserved: u16,
    pub payload_len: u32,
}

impl FrameHeader {
    pub fn new(flags: u8, payload_len: u32) -> Self {
        Self {
            magic: MAGIC_BYTES,
            version: CURRENT_VERSION,
            flags,
            reserved: 0,
            payload_len,
        }
    }

    pub fn to_bytes(&self) -> [u8; 12] {
        let mut buf = [0u8; 12];
        buf[0..4].copy_from_slice(&self.magic);
        buf[4] = self.version;
        buf[5] = self.flags;
        buf[6..8].copy_from_slice(&self.reserved.to_le_bytes());
        buf[8..12].copy_from_slice(&self.payload_len.to_le_bytes());
        buf
    }

    pub fn from_bytes(buf: &[u8; 12]) -> Result<Self, String> {
        let magic = [buf[0], buf[1], buf[2], buf[3]];
        let version = buf[4];
        let flags = buf[5];
        let reserved = u16::from_le_bytes([buf[6], buf[7]]);
        let payload_len = u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]);

        let header = Self {
            magic,
            version,
            flags,
            reserved,
            payload_len,
        };
        header.validate()?;
        Ok(header)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.magic != MAGIC_BYTES {
            return Err("Invalid magic bytes in frame header".into());
        }
        if self.version > CURRENT_VERSION {
            return Err(format!(
                "Unsupported future transport version: {}",
                self.version
            ));
        }
        if self.reserved != 0 {
            return Err("Reserved header bytes must be zero".into());
        }
        if (self.flags & !FLAG_STATS_PRESENT) != 0 {
            return Err(format!("Unknown transport header flags: {:#x}", self.flags));
        }
        if self.payload_len > MAX_PAYLOAD_LEN {
            return Err("Frame payload exceeds 10MB safety limit".into());
        }
        Ok(())
    }
}

/// 16-byte transport statistics metadata header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(C)]
pub struct TransportStats {
    pub dropped_frames: u64,
    pub queue_depth: u32,
    pub reserved: u32,
}

impl TransportStats {
    pub fn to_bytes(&self) -> [u8; 16] {
        let mut buf = [0u8; 16];
        buf[0..8].copy_from_slice(&self.dropped_frames.to_le_bytes());
        buf[8..12].copy_from_slice(&self.queue_depth.to_le_bytes());
        buf[12..16].copy_from_slice(&self.reserved.to_le_bytes());
        buf
    }

    pub fn from_bytes(buf: &[u8; 16]) -> Result<Self, String> {
        let dropped_frames = u64::from_le_bytes(buf[0..8].try_into().unwrap());
        let queue_depth = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        let reserved = u32::from_le_bytes(buf[12..16].try_into().unwrap());
        if reserved != 0 {
            return Err("Reserved field in TransportStats must be zero".into());
        }
        Ok(Self {
            dropped_frames,
            queue_depth,
            reserved,
        })
    }
}

/// Owned binary frame for frame batch creation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryFrame {
    pub frame_seq_num: u64,
    pub mono_nanos: u64,
    pub iface_id: u32,
    pub wire_len: u32,
    pub caplen: u32,
    pub pkt_data: Vec<u8>,
}

/// Borrowed zero-allocation binary frame view over a receive buffer slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BinaryFrameView<'a> {
    pub frame_seq_num: u64,
    pub mono_nanos: u64,
    pub iface_id: u32,
    pub wire_len: u32,
    pub caplen: u32,
    pub pkt_data: &'a [u8],
}

/// Owned binary frame batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryFrameBatch {
    pub batch_seq_num: u64,
    pub stats: Option<TransportStats>,
    pub frames: Vec<BinaryFrame>,
}

impl BinaryFrameBatch {
    pub fn encode_payload(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&self.batch_seq_num.to_le_bytes());
        buf.extend_from_slice(&(self.frames.len() as u32).to_le_bytes());
        if let Some(stats) = &self.stats {
            buf.extend_from_slice(&stats.to_bytes());
        }
        for f in &self.frames {
            buf.extend_from_slice(&f.frame_seq_num.to_le_bytes());
            buf.extend_from_slice(&f.mono_nanos.to_le_bytes());
            buf.extend_from_slice(&f.iface_id.to_le_bytes());
            buf.extend_from_slice(&f.wire_len.to_le_bytes());
            buf.extend_from_slice(&(f.pkt_data.len() as u32).to_le_bytes());
            buf.extend_from_slice(&f.pkt_data);
        }
        buf
    }
}

/// Borrowed zero-allocation binary frame batch view over a receive buffer slice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryFrameBatchView<'a> {
    pub batch_seq_num: u64,
    pub frame_count: u32,
    pub stats: Option<TransportStats>,
    pub frames: Vec<BinaryFrameView<'a>>,
}

/// High-performance binary transport codec supporting zero-allocation borrowed decoding.
#[derive(Debug, Default)]
pub struct BinaryFrameCodec;

impl BinaryFrameCodec {
    pub fn encode_header(&self, header: &FrameHeader) -> [u8; 12] {
        header.to_bytes()
    }

    pub fn decode_header(&self, buf: &[u8; 12]) -> Result<FrameHeader, String> {
        FrameHeader::from_bytes(buf)
    }

    pub fn validate_header(&self, header: &FrameHeader) -> Result<(), String> {
        header.validate()
    }

    pub fn decode_batch_view<'a>(
        &self,
        buf: &'a [u8],
        stats_present: bool,
    ) -> Result<BinaryFrameBatchView<'a>, String> {
        let mut offset = 0;
        if buf.len() < 12 {
            return Err("Payload too short for batch header".into());
        }
        let batch_seq_num = u64::from_le_bytes(buf[0..8].try_into().unwrap());
        let frame_count = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        offset += 12;

        let stats = if stats_present {
            if buf.len() < offset + 16 {
                return Err("Payload too short for TransportStats".into());
            }
            let raw_stats: &[u8; 16] = buf[offset..offset + 16].try_into().unwrap();
            let parsed_stats = TransportStats::from_bytes(raw_stats)?;
            offset += 16;
            Some(parsed_stats)
        } else {
            None
        };

        let mut frames = Vec::with_capacity(frame_count as usize);
        for _ in 0..frame_count {
            if buf.len() < offset + 28 {
                return Err("Payload truncated inside frame metadata".into());
            }
            let frame_seq_num = u64::from_le_bytes(buf[offset..offset + 8].try_into().unwrap());
            let mono_nanos = u64::from_le_bytes(buf[offset + 8..offset + 16].try_into().unwrap());
            let iface_id = u32::from_le_bytes(buf[offset + 16..offset + 20].try_into().unwrap());
            let wire_len = u32::from_le_bytes(buf[offset + 20..offset + 24].try_into().unwrap());
            let caplen =
                u32::from_le_bytes(buf[offset + 24..offset + 28].try_into().unwrap()) as usize;
            offset += 28;

            if caplen > (wire_len as usize) {
                return Err("Captured length exceeds wire length".into());
            }
            if buf.len() < offset + caplen {
                return Err("Payload truncated inside packet data".into());
            }
            let pkt_data = &buf[offset..offset + caplen];
            offset += caplen;

            frames.push(BinaryFrameView {
                frame_seq_num,
                mono_nanos,
                iface_id,
                wire_len,
                caplen: caplen as u32,
                pkt_data,
            });
        }

        Ok(BinaryFrameBatchView {
            batch_seq_num,
            frame_count,
            stats,
            frames,
        })
    }
}

pub trait Codec: Send + Sync {
    fn encode<T: Serialize>(&self, item: &T) -> Result<Vec<u8>, String>;
    fn decode<T: DeserializeOwned>(&self, buf: &[u8]) -> Result<T, String>;
}

#[derive(Debug)]
pub struct JsonCodec;

impl Codec for JsonCodec {
    fn encode<T: Serialize>(&self, item: &T) -> Result<Vec<u8>, String> {
        serde_json::to_vec(item).map_err(|e| e.to_string())
    }

    fn decode<T: DeserializeOwned>(&self, buf: &[u8]) -> Result<T, String> {
        serde_json::from_slice(buf).map_err(|e| e.to_string())
    }
}

impl JsonCodec {
    pub fn validate_header(&self, header: &FrameHeader) -> Result<(), String> {
        header.validate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_magic_and_version_compatibility() {
        let codec = BinaryFrameCodec;
        let valid_hdr = FrameHeader::new(0, 1024);
        assert!(codec.validate_header(&valid_hdr).is_ok());

        let mut invalid_magic = valid_hdr;
        invalid_magic.magic = *b"BADM";
        assert!(codec.validate_header(&invalid_magic).is_err());

        let mut invalid_version = valid_hdr;
        invalid_version.version = 99;
        assert!(codec.validate_header(&invalid_version).is_err());

        let mut invalid_reserved = valid_hdr;
        invalid_reserved.reserved = 1;
        assert!(codec.validate_header(&invalid_reserved).is_err());

        let mut invalid_flags = valid_hdr;
        invalid_flags.flags = 0b1000_0000;
        assert!(codec.validate_header(&invalid_flags).is_err());
    }

    #[test]
    fn test_security_payload_bounding() {
        let codec = BinaryFrameCodec;
        let oversized_hdr = FrameHeader::new(0, 50 * 1024 * 1024); // 50MB
        let res = codec.validate_header(&oversized_hdr);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("safety limit"));
    }

    #[test]
    fn test_header_bytes_roundtrip() {
        let hdr = FrameHeader::new(FLAG_STATS_PRESENT, 2048);
        let bytes = hdr.to_bytes();
        let parsed = FrameHeader::from_bytes(&bytes).unwrap();
        assert_eq!(hdr, parsed);
    }

    #[test]
    fn test_transport_stats_wire_layout() {
        let stats = TransportStats {
            dropped_frames: 42,
            queue_depth: 150,
            reserved: 0,
        };
        let bytes = stats.to_bytes();
        let parsed = TransportStats::from_bytes(&bytes).unwrap();
        assert_eq!(stats, parsed);

        let mut invalid_reserved_bytes = bytes;
        invalid_reserved_bytes[12] = 1;
        assert!(TransportStats::from_bytes(&invalid_reserved_bytes).is_err());
    }

    #[test]
    fn test_binary_frame_batch_borrowed_roundtrip() {
        let codec = BinaryFrameCodec;
        let frame1 = BinaryFrame {
            frame_seq_num: 1,
            mono_nanos: 1_000_000,
            iface_id: 2,
            wire_len: 64,
            caplen: 4,
            pkt_data: vec![0xde, 0xad, 0xbe, 0xef],
        };
        let frame2 = BinaryFrame {
            frame_seq_num: 2,
            mono_nanos: 2_000_000,
            iface_id: 2,
            wire_len: 128,
            caplen: 6,
            pkt_data: vec![1, 2, 3, 4, 5, 6],
        };
        let stats = TransportStats {
            dropped_frames: 10,
            queue_depth: 25,
            reserved: 0,
        };
        let batch = BinaryFrameBatch {
            batch_seq_num: 100,
            stats: Some(stats),
            frames: vec![frame1.clone(), frame2.clone()],
        };

        let payload_bytes = batch.encode_payload();
        let view = codec.decode_batch_view(&payload_bytes, true).unwrap();

        assert_eq!(view.batch_seq_num, 100);
        assert_eq!(view.frame_count, 2);
        assert_eq!(view.stats, Some(stats));
        assert_eq!(view.frames.len(), 2);

        assert_eq!(view.frames[0].frame_seq_num, 1);
        assert_eq!(view.frames[0].pkt_data, &frame1.pkt_data[..]);

        assert_eq!(view.frames[1].frame_seq_num, 2);
        assert_eq!(view.frames[1].pkt_data, &frame2.pkt_data[..]);
    }
}
