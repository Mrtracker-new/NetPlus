//! Versioned Framed Fleet Transport Protocol & Codec Abstraction.

use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub const MAGIC_BYTES: [u8; 4] = *b"NPFL";
pub const CURRENT_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameHeader {
    pub magic: [u8; 4],
    pub version: u16,
    pub flags: u16,
    pub payload_len: u32,
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
        if header.magic != MAGIC_BYTES {
            return Err("Invalid magic bytes in frame header".to_string());
        }
        if header.version > CURRENT_VERSION {
            return Err(format!(
                "Unsupported future transport version: {}",
                header.version
            ));
        }
        if header.payload_len > 10 * 1024 * 1024 {
            return Err("Frame payload exceeds 10MB safety limit".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transport_magic_and_version_compatibility() {
        let codec = JsonCodec;
        let valid_hdr = FrameHeader {
            magic: MAGIC_BYTES,
            version: CURRENT_VERSION,
            flags: 0,
            payload_len: 1024,
        };
        assert!(codec.validate_header(&valid_hdr).is_ok());

        let invalid_magic = FrameHeader {
            magic: *b"BADM",
            version: CURRENT_VERSION,
            flags: 0,
            payload_len: 1024,
        };
        assert!(codec.validate_header(&invalid_magic).is_err());
    }

    #[test]
    fn test_security_payload_bounding() {
        let codec = JsonCodec;
        let oversized_hdr = FrameHeader {
            magic: MAGIC_BYTES,
            version: CURRENT_VERSION,
            flags: 0,
            payload_len: 50 * 1024 * 1024, // 50MB
        };
        let res = codec.validate_header(&oversized_hdr);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("safety limit"));
    }
}
