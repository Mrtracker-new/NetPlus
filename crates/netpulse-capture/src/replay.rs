//! The Replay data source and time control (docs/21). Replay's core design rule
//! is that it **reuses the exact same pipeline as live capture** — the only thing
//! that changes is the source of frames (docs/21 §4). [`ReplaySource`] is that
//! source: another [`CaptureSource`] (docs/05 §5) that reads a recording's frames
//! instead of a NIC, preserving their **original capture timestamps** so replay
//! timelines are truthful (docs/21 §6).
//!
//! [`ReplayController`] adds the time control the live view can't offer (docs/21
//! §5): play/pause, speed, step, and seek. Seeking uses the recording's
//! checkpoints (docs/22 §3) so it need not replay from the very start each time
//! (docs/21 §5). All timing derives from recorded timestamps against a virtual
//! clock — **never `now()` or RNG** (docs/21 §6, §11) — which is what makes a
//! recording replay byte-identically every run.

use netpulse_core::traits::{CaptureSource, RawFrame};
use netpulse_core::Result;
use netpulse_decode::LinkType;

use crate::recording::{Checkpoint, Recording};

/// A read-only frame feed the offline pipeline can drive, exposing the capture
/// timestamps it needs. Both [`crate::FileCapture`] (live-import) and
/// [`ReplaySource`] (replay) implement it, so one pipeline serves both sources
/// (docs/21 §4 — "one pipeline, two sources").
pub trait FrameFeed {
    /// The link type of the frames, feeding the decoder (docs/07 §4.2).
    fn link_type(&self) -> LinkType;
    /// Wall-clock ns for the frame at absolute index `i`, paired with the frame's
    /// monotonic reading downstream (docs/05 §6).
    fn wall_nanos_at(&self, i: usize) -> Option<u64>;
    /// Pull the next count-bounded batch of frames, empty at end-of-stream.
    fn next_frames(&mut self) -> Result<Vec<RawFrame>>;
}

/// A [`CaptureSource`] backed by a recording (docs/21 §4). It hands frames out in
/// recorded order with their original monotonic timestamps derived exactly as the
/// file-import source does (docs/05 §6), so replaying a recording reproduces the
/// same reconstruction the original capture produced (docs/21 §10 parity).
#[derive(Debug)]
pub struct ReplaySource {
    link_type: LinkType,
    frames: Vec<RawFrame>,
    wall_nanos: Vec<u64>,
    cursor: usize,
    batch_size: usize,
    /// True when the underlying recording was truncated (docs/22 §8): replay
    /// reproduces up to the boundary honestly (docs/21 §8).
    incomplete: bool,
}

impl ReplaySource {
    /// Build a replay source from a sealed recording (docs/21 §4).
    pub fn from_recording(recording: &Recording) -> Result<Self> {
        let parsed = crate::pcapng::parse(&recording.pcapng_bytes)?;
        // Derive a monotonic clock from the first frame's wall time, identically
        // to the file-import source (docs/05 §6), so replay and live-import agree
        // to the nanosecond and reconstruction is byte-identical (docs/21 §6).
        let base = parsed
            .records
            .first()
            .map(|r| r.ts_secs * 1_000_000_000 + r.ts_nanos as u64)
            .unwrap_or(0);
        let mut frames = Vec::with_capacity(parsed.records.len());
        let mut wall_nanos = Vec::with_capacity(parsed.records.len());
        for r in &parsed.records {
            let wall = r.ts_secs * 1_000_000_000 + r.ts_nanos as u64;
            frames.push(RawFrame {
                mono_nanos: wall.saturating_sub(base),
                iface_id: 0,
                bytes: r.data.clone(),
            });
            wall_nanos.push(wall);
        }
        Ok(Self {
            link_type: parsed.link_type,
            frames,
            wall_nanos,
            cursor: 0,
            batch_size: 64,
            incomplete: parsed.truncated,
        })
    }

    /// Total frames in the recording.
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }

    /// Whether the recording was truncated (docs/21 §8 honest incompleteness).
    pub fn is_incomplete(&self) -> bool {
        self.incomplete
    }

    /// Override the batch size handed out per call.
    pub fn set_batch_size(&mut self, n: usize) {
        self.batch_size = n.max(1);
    }
}

impl FrameFeed for ReplaySource {
    fn link_type(&self) -> LinkType {
        self.link_type
    }
    fn wall_nanos_at(&self, i: usize) -> Option<u64> {
        self.wall_nanos.get(i).copied()
    }
    fn next_frames(&mut self) -> Result<Vec<RawFrame>> {
        self.next_batch()
    }
}

impl CaptureSource for ReplaySource {
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

/// The playback state a UI renders (docs/21 §5). `speed_percent` is 100 for 1×,
/// 10 for slow-motion 0.1× (teaching, docs/16), 1000 for 10× review — an integer
/// so it stays exact on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayState {
    pub position_nanos: u64,
    pub total_nanos: u64,
    pub speed_percent: u32,
    pub playing: bool,
    pub frame_index: u64,
    /// The recording was truncated; reconstruction is marked incomplete where the
    /// recording was (docs/21 §8).
    pub incomplete: bool,
}

/// Interactive time control over a recording (docs/21 §5). It decouples
/// *position* from wall-clock: play/pause/speed/step/seek move a virtual cursor
/// over the recorded frame timeline. Seeking snaps to the nearest checkpoint at or
/// before the target (docs/22 §3) so it need not scan from the start (docs/21 §5).
///
/// It holds no `now()`/RNG state — position advances only by recorded frame times,
/// keeping replay deterministic (docs/21 §6, §11).
#[derive(Debug, Clone)]
pub struct ReplayController {
    /// Monotonic time of each frame, ascending (the virtual-clock keyframes).
    frame_times: Vec<u64>,
    checkpoints: Vec<Checkpoint>,
    total_nanos: u64,
    incomplete: bool,
    cursor: usize,
    speed_percent: u32,
    playing: bool,
}

impl ReplayController {
    /// Build a controller for a recording (docs/21 §5). Reads the frame timeline
    /// and checkpoints from the recording's frames and manifest.
    pub fn from_recording(recording: &Recording) -> Result<Self> {
        let frames = recording.frames()?;
        let base = frames
            .first()
            .map(|r| r.ts_secs * 1_000_000_000 + r.ts_nanos as u64)
            .unwrap_or(0);
        let frame_times: Vec<u64> = frames
            .iter()
            .map(|r| (r.ts_secs * 1_000_000_000 + r.ts_nanos as u64).saturating_sub(base))
            .collect();
        let total_nanos = frame_times.last().copied().unwrap_or(0);
        Ok(Self {
            frame_times,
            checkpoints: recording.manifest.checkpoints.clone(),
            total_nanos,
            incomplete: crate::pcapng::parse(&recording.pcapng_bytes)?.truncated,
            cursor: 0,
            speed_percent: 100,
            playing: false,
        })
    }

    /// Start playback (docs/21 §5).
    pub fn play(&mut self) {
        self.playing = true;
    }

    /// Pause playback (docs/21 §5).
    pub fn pause(&mut self) {
        self.playing = false;
    }

    /// Set playback speed as a percentage of real time (100 = 1×). Clamped to a
    /// sane, non-zero range so time never stops or runs backwards (docs/21 §5).
    pub fn set_speed(&mut self, percent: u32) {
        self.speed_percent = percent.clamp(1, 10_000);
    }

    /// Advance exactly one frame/event — ideal for lessons ("now the SYN, now the
    /// SYN-ACK…", docs/21 §5). Saturates at the last frame.
    pub fn step(&mut self) {
        if self.cursor + 1 < self.frame_times.len() {
            self.cursor += 1;
        }
    }

    /// Seek to `mono_nanos`, reconstructing position as of that instant (docs/21
    /// §5). Snaps to the nearest checkpoint at or before the target, then advances
    /// over frames — so a seek is bounded by the checkpoint spacing, not O(n) from
    /// the start.
    pub fn seek(&mut self, mono_nanos: u64) {
        // Start from the newest checkpoint whose time is <= target (docs/22 §3).
        let mut idx = self
            .checkpoints
            .iter()
            .filter(|c| c.mono_nanos <= mono_nanos)
            .map(|c| c.frame_index as usize)
            .max()
            .unwrap_or(0)
            .min(self.frame_times.len().saturating_sub(1));
        // Advance from the checkpoint to the exact frame at/before the target.
        while idx + 1 < self.frame_times.len() && self.frame_times[idx + 1] <= mono_nanos {
            idx += 1;
        }
        self.cursor = idx;
    }

    /// The current playback state to render (docs/21 §5).
    pub fn state(&self) -> ReplayState {
        ReplayState {
            position_nanos: self.frame_times.get(self.cursor).copied().unwrap_or(0),
            total_nanos: self.total_nanos,
            speed_percent: self.speed_percent,
            playing: self.playing,
            frame_index: self.cursor as u64,
            incomplete: self.incomplete,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcap::PcapRecord;
    use crate::recording::{Recorder, RecordingScope};

    fn recording(n: u64) -> Recording {
        let mut r = Recorder::start(LinkType::Ethernet, RecordingScope::default());
        for i in 0..n {
            // 10ms apart, so frame i sits at mono = i*10ms.
            r.push(
                i * 10_000_000,
                PcapRecord {
                    ts_secs: 1_700_000_000,
                    ts_nanos: (i * 10_000_000) as u32,
                    data: vec![i as u8, 1, 2, 3],
                    orig_len: 4,
                },
            );
        }
        r.finalize(4)
    }

    #[test]
    fn replay_is_deterministic() {
        // The determinism meta-test (docs/21 §10): two replays of the same
        // recording yield byte-identical frame sequences and timestamps.
        let rec = recording(20);
        let drain = |mut s: ReplaySource| {
            let mut all = Vec::new();
            loop {
                let b = s.next_batch().unwrap();
                if b.is_empty() {
                    break;
                }
                for f in b {
                    all.push((f.mono_nanos, f.bytes));
                }
            }
            all
        };
        let run1 = drain(ReplaySource::from_recording(&rec).unwrap());
        let run2 = drain(ReplaySource::from_recording(&rec).unwrap());
        assert_eq!(run1, run2);
        assert_eq!(run1.len(), 20);
        assert_eq!(run1[0].0, 0); // first frame at t=0
    }

    #[test]
    fn seek_matches_linear_scan() {
        // Seek correctness (docs/21 §10): seeking to T lands on the same frame a
        // linear play-to-T would.
        let rec = recording(200); // checkpoints at 0, 64, 128, 192
        let mut ctrl = ReplayController::from_recording(&rec).unwrap();
        let target = 1_005_000_000u64; // between frame 100 (1.00s) and 101 (1.01s)
        ctrl.seek(target);
        let by_seek = ctrl.state().frame_index;
        // Linear expectation: the last frame whose time <= target.
        let expected = (0..200u64).filter(|i| i * 10_000_000 <= target).count() as u64 - 1;
        assert_eq!(by_seek, expected);
    }

    #[test]
    fn step_advances_one_and_saturates() {
        let rec = recording(3);
        let mut ctrl = ReplayController::from_recording(&rec).unwrap();
        assert_eq!(ctrl.state().frame_index, 0);
        ctrl.step();
        assert_eq!(ctrl.state().frame_index, 1);
        ctrl.step();
        ctrl.step();
        ctrl.step(); // saturate at last
        assert_eq!(ctrl.state().frame_index, 2);
    }

    #[test]
    fn speed_clamps_and_never_stops() {
        let rec = recording(2);
        let mut ctrl = ReplayController::from_recording(&rec).unwrap();
        ctrl.set_speed(0); // would stop time
        assert_eq!(ctrl.state().speed_percent, 1);
        ctrl.set_speed(1000); // 10× review
        assert_eq!(ctrl.state().speed_percent, 1000);
    }
}
