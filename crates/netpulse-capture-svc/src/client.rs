//! IPC Frame Client & `CaptureSource` Implementation.
//!
//! Connects to `netpulse-capture-svc` daemon over Unix domain socket or Windows named pipe,
//! reads 12-byte framed `BinaryFrameBatch` streams, and yields `RawFrame`s into `LivePipeline`.

use netpulse_core::error::NpError;
use netpulse_core::traits::{CaptureSource, RawFrame};
use netpulse_core::Result;

use std::io::Read;

use crate::transport::{BinaryFrameCodec, FLAG_STATS_PRESENT};

/// Client for consuming raw frame streams from the privileged `netpulse-capture-svc` daemon over IPC.
pub struct IpcCaptureSource<R: Read> {
    reader: R,
    codec: BinaryFrameCodec,
    last_batch_seq: Option<u64>,
    last_frame_seq: Option<u64>,
    received_frames: u64,
    dropped_frames: u64,
    read_buf: Vec<u8>,
}

impl<R: Read> std::fmt::Debug for IpcCaptureSource<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IpcCaptureSource")
            .field("last_batch_seq", &self.last_batch_seq)
            .field("last_frame_seq", &self.last_frame_seq)
            .field("received_frames", &self.received_frames)
            .field("dropped_frames", &self.dropped_frames)
            .finish_non_exhaustive()
    }
}

impl<R: Read> IpcCaptureSource<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            codec: BinaryFrameCodec,
            last_batch_seq: None,
            last_frame_seq: None,
            received_frames: 0,
            dropped_frames: 0,
            read_buf: Vec::with_capacity(64 * 1024),
        }
    }

    /// Cumulative `(received, dropped)` packet count.
    pub fn stats(&self) -> (u64, u64) {
        (self.received_frames, self.dropped_frames)
    }

    /// Read the next framed binary batch from the IPC reader stream.
    fn read_next_batch(&mut self) -> Result<Vec<RawFrame>> {
        let mut header_buf = [0u8; 12];
        if let Err(e) = self.reader.read_exact(&mut header_buf) {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                // Stream closed cleanly by daemon
                return Ok(Vec::new());
            }
            return Err(NpError::Capability(format!(
                "Failed to read IPC frame header: {e}"
            )));
        }

        let header = self
            .codec
            .decode_header(&header_buf)
            .map_err(|e| NpError::Capability(format!("Transport corruption in header: {e}")))?;

        let payload_len = header.payload_len as usize;
        self.read_buf.resize(payload_len, 0);

        self.reader
            .read_exact(&mut self.read_buf)
            .map_err(|e| NpError::Capability(format!("Failed to read IPC frame payload: {e}")))?;

        let stats_present = (header.flags & FLAG_STATS_PRESENT) != 0;
        let view = self
            .codec
            .decode_batch_view(&self.read_buf, stats_present)
            .map_err(|e| NpError::Capability(format!("Transport corruption in payload: {e}")))?;

        // Batch sequence gap detection
        if let Some(last_batch) = self.last_batch_seq {
            if view.batch_seq_num > last_batch + 1 {
                let skipped_batches = view.batch_seq_num - (last_batch + 1);
                tracing::warn!(
                    event = "ipc.batch_sequence_gap",
                    last_batch = last_batch,
                    current_batch = view.batch_seq_num,
                    skipped_batches = skipped_batches,
                    "Detected IPC batch sequence gap"
                );
            }
        }
        self.last_batch_seq = Some(view.batch_seq_num);

        // Update stats if attached
        if let Some(stats) = &view.stats {
            self.dropped_frames = self.dropped_frames.max(stats.dropped_frames);
        }

        let mut frames = Vec::with_capacity(view.frames.len());
        for f in &view.frames {
            // Frame sequence gap detection
            if let Some(last_seq) = self.last_frame_seq {
                if f.frame_seq_num > last_seq + 1 {
                    let gap = f.frame_seq_num - (last_seq + 1);
                    self.dropped_frames = self.dropped_frames.saturating_add(gap);
                    tracing::warn!(
                        event = "ipc.frame_sequence_gap",
                        last_seq = last_seq,
                        current_seq = f.frame_seq_num,
                        gap = gap,
                        "Detected IPC frame sequence gap"
                    );
                }
            }
            self.last_frame_seq = Some(f.frame_seq_num);
            self.received_frames = self.received_frames.saturating_add(1);

            frames.push(RawFrame {
                mono_nanos: f.mono_nanos,
                iface_id: f.iface_id as u16,
                bytes: f.pkt_data.to_vec(),
            });
        }

        Ok(frames)
    }
}

impl<R: Read> CaptureSource for IpcCaptureSource<R> {
    fn next_batch(&mut self) -> Result<Vec<RawFrame>> {
        self.read_next_batch()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{BinaryFrame, BinaryFrameBatch, FrameHeader, TransportStats};
    use std::io::Cursor;

    #[test]
    fn test_ipc_capture_source_decodes_framed_batch() {
        let frame1 = BinaryFrame {
            frame_seq_num: 1,
            mono_nanos: 1_000_000,
            iface_id: 1,
            wire_len: 64,
            caplen: 4,
            pkt_data: vec![0xde, 0xad, 0xbe, 0xef],
        };
        let frame2 = BinaryFrame {
            frame_seq_num: 2,
            mono_nanos: 2_000_000,
            iface_id: 1,
            wire_len: 128,
            caplen: 6,
            pkt_data: vec![1, 2, 3, 4, 5, 6],
        };
        let stats = TransportStats {
            dropped_frames: 5,
            queue_depth: 10,
            reserved: 0,
        };
        let batch = BinaryFrameBatch {
            batch_seq_num: 1,
            stats: Some(stats),
            frames: vec![frame1.clone(), frame2.clone()],
        };

        let payload_bytes = batch.encode_payload();
        let header = FrameHeader::new(FLAG_STATS_PRESENT, payload_bytes.len() as u32);
        let header_bytes = header.to_bytes();

        let mut stream_bytes = Vec::new();
        stream_bytes.extend_from_slice(&header_bytes);
        stream_bytes.extend_from_slice(&payload_bytes);

        let cursor = Cursor::new(stream_bytes);
        let mut source = IpcCaptureSource::new(cursor);

        let batch_frames = source.next_batch().unwrap();
        assert_eq!(batch_frames.len(), 2);
        assert_eq!(batch_frames[0].bytes, frame1.pkt_data);
        assert_eq!(batch_frames[1].bytes, frame2.pkt_data);

        let (rx, dropped) = source.stats();
        assert_eq!(rx, 2);
        assert_eq!(dropped, 5);
    }
}
