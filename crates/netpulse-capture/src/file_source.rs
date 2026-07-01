//! The file-based [`CaptureSource`] (docs/05 §12–13). Recorded `pcap` fixtures
//! feed the *exact same pipeline* as live capture, so the whole engine is
//! testable deterministically without privileges (docs/05 §12) — and the same
//! path powers importing external pcap files for offline analysis (docs/05 §13).
//! "Capture from wire and capture from file converge immediately after this
//! layer."
//!
//! It yields [`RawFrame`]s in the same shape a live backend would, carrying the
//! **capture-time** monotonic timestamp (docs/05 §6): frames retain when they
//! were captured, so replay timelines are truthful.

use netpulse_core::traits::{CaptureSource, RawFrame};
use netpulse_core::Result;
use netpulse_decode::LinkType;

use crate::pcap::PcapFile;

/// A [`CaptureSource`] backed by a parsed pcap file. Hands frames out in
/// count-bounded batches, mirroring how a live drain hands off batches to the
/// engine (docs/05 §4.2).
#[derive(Debug)]
pub struct FileCapture {
    link_type: LinkType,
    frames: Vec<RawFrame>,
    cursor: usize,
    batch_size: usize,
    /// Wall-clock ns of each frame, parallel to `frames`, exposed for the engine
    /// to pair with the monotonic reading (docs/05 §6).
    wall_nanos: Vec<u64>,
}

impl FileCapture {
    /// Build from raw pcap bytes, tagging every frame with `iface_id`.
    pub fn from_bytes(bytes: &[u8], iface_id: u16) -> Result<Self> {
        let pcap = PcapFile::parse(bytes)?;
        Self::from_pcap(pcap, iface_id)
    }

    /// Build from an already-parsed [`PcapFile`].
    pub fn from_pcap(pcap: PcapFile, iface_id: u16) -> Result<Self> {
        // Derive a monotonic clock from the first record's wall time, so
        // durations are correct regardless of the absolute epoch (docs/05 §6).
        let base = pcap
            .records
            .first()
            .map(|r| r.ts_secs * 1_000_000_000 + r.ts_nanos as u64)
            .unwrap_or(0);
        let mut frames = Vec::with_capacity(pcap.records.len());
        let mut wall_nanos = Vec::with_capacity(pcap.records.len());
        for r in &pcap.records {
            let wall = r.ts_secs * 1_000_000_000 + r.ts_nanos as u64;
            frames.push(RawFrame {
                mono_nanos: wall.saturating_sub(base),
                iface_id,
                bytes: r.data.clone(),
            });
            wall_nanos.push(wall);
        }
        Ok(Self {
            link_type: pcap.link_type,
            frames,
            cursor: 0,
            batch_size: 64,
            wall_nanos,
        })
    }

    /// The link type of the capture (feeds the decoder, docs/07 §4.2).
    pub fn link_type(&self) -> LinkType {
        self.link_type
    }

    /// Wall-clock ns for the frame at absolute index `i` (docs/05 §6).
    pub fn wall_nanos_at(&self, i: usize) -> Option<u64> {
        self.wall_nanos.get(i).copied()
    }

    /// Total frames in the capture.
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// Override the batch size handed out per `next_batch` call.
    pub fn set_batch_size(&mut self, n: usize) {
        self.batch_size = n.max(1);
    }
}

impl CaptureSource for FileCapture {
    /// Hand out the next batch of frames, or an empty batch at end-of-file
    /// (clean shutdown, per the trait contract).
    fn next_batch(&mut self) -> Result<Vec<RawFrame>> {
        if self.cursor >= self.frames.len() {
            return Ok(Vec::new());
        }
        let end = (self.cursor + self.batch_size).min(self.frames.len());
        let batch = self.frames[self.cursor..end].to_vec();
        self.cursor = end;
        Ok(batch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_pcap(frames: &[&[u8]]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&0xa1b2c3d4u32.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&4u16.to_le_bytes());
        b.extend_from_slice(&0i32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&65535u32.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes()); // Ethernet
        for (i, f) in frames.iter().enumerate() {
            b.extend_from_slice(&(1000 + i as u32).to_le_bytes()); // ts sec
            b.extend_from_slice(&0u32.to_le_bytes()); // ts usec
            b.extend_from_slice(&(f.len() as u32).to_le_bytes());
            b.extend_from_slice(&(f.len() as u32).to_le_bytes());
            b.extend_from_slice(f);
        }
        b
    }

    #[test]
    fn yields_all_frames_then_empty() {
        let bytes = tiny_pcap(&[&[1, 2], &[3, 4], &[5, 6]]);
        let mut cap = FileCapture::from_bytes(&bytes, 7).unwrap();
        cap.set_batch_size(2);
        let b1 = cap.next_batch().unwrap();
        assert_eq!(b1.len(), 2);
        assert_eq!(b1[0].iface_id, 7);
        let b2 = cap.next_batch().unwrap();
        assert_eq!(b2.len(), 1);
        assert!(cap.next_batch().unwrap().is_empty()); // EOF
    }

    #[test]
    fn monotonic_timestamps_are_relative_to_first() {
        let bytes = tiny_pcap(&[&[0], &[0], &[0]]);
        let mut cap = FileCapture::from_bytes(&bytes, 0).unwrap();
        let all = cap.next_batch().unwrap();
        assert_eq!(all[0].mono_nanos, 0);
        assert_eq!(all[1].mono_nanos, 1_000_000_000); // +1s
        assert_eq!(all[2].mono_nanos, 2_000_000_000);
    }
}
