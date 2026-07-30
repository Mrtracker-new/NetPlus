//! # netpulse-capture
//!
//! The capture-layer pipeline logic (docs/05): the file-based [`FileCapture`]
//! source, its [`pcap`] reader, the staged-shedding policy, and honest drop
//! accounting. Uses [`netpulse_platform`] for the *live* byte source; the
//! file-based source needs no platform code, so the whole pipeline is testable
//! without privileges (docs/05 §12).
//!
//! The golden rule (docs/02 §5.3): capture must never block on analysis. The
//! capture thread's only job is receive → timestamp → enqueue → return; when
//! downstream falls behind, a *named shedding policy* ([`ShedStage`]) decides
//! what to drop and records it for honest disclosure (docs/05 §9).
//!
//! **Phase 1 slice:** the file/import path (docs/05 §13) is fully implemented;
//! live per-OS backends remain in [`netpulse_platform`] as documented stubs.
//!
//! **Phase 5 (docs/21–23):** the capture layer also owns the lifecycle formats —
//! the [`pcapng`] codec (interop gold standard), [`recording`] (durable,
//! replayable, privacy-manifested artifacts), and [`replay`] (a deterministic
//! [`recording::Recording`]-backed [`netpulse_core::traits::CaptureSource`] plus
//! interactive time control). Replay reuses the exact live pipeline — only the
//! frame source changes (docs/21 §4).
#![forbid(unsafe_code)]

pub mod file_source;
pub mod pcap;
pub mod pcapng;
pub mod recording;
pub mod replay;

pub use file_source::FileCapture;
pub use pcap::{PcapFile, PcapRecord};
pub use pcapng::PcapngFile;
pub use recording::{
    record_last_n, Checkpoint, PrivacyManifest, Recorder, Recording, RecordingManifest,
    RecordingPayloadLevel, RecordingScope, VersionPins,
};
pub use replay::{FrameFeed, ReplayController, ReplaySource, ReplayState};
use serde::{Deserialize, Serialize};

/// Minimum Ethernet (14) + IPv4 (20) + TCP (20) header length.
/// Packets with VLAN tags (802.1Q), IPv6, or TCP options may require
/// larger headers.
pub const ETH_IPV4_TCP_HEADERS: usize = 54;

/// The staged shedding order (docs/02 §8.2, docs/05 §9), preferring to lose
/// *detail* before *truth*. Encoded as a first-class, testable type: a missing
/// payload costs depth, but a missing SYN/FIN corrupts a flow's state machine,
/// so detail is sacrificed first and truth-loss is always disclosed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub enum ShedStage {
    /// Full fidelity — nothing shed.
    #[default]
    None,
    /// Stop storing payloads; keep headers + flow metrics.
    PayloadsOff,
    /// Fully dissect only a sample; count the rest into metrics.
    SampleDissection,
    /// Aggregate metrics at longer intervals.
    CoarsenMetrics,
    /// Last resort: drop at the kernel/ring boundary (Option A: sliding window evicting oldest),
    /// and *record* the drop.
    DropPackets,
}

impl ShedStage {
    /// The next more-aggressive stage, saturating at [`ShedStage::DropPackets`]
    /// (docs/05 §9: escalate only when the kernel ring keeps filling).
    pub fn escalate(self) -> Self {
        match self {
            ShedStage::None => ShedStage::PayloadsOff,
            ShedStage::PayloadsOff => ShedStage::SampleDissection,
            ShedStage::SampleDissection => ShedStage::CoarsenMetrics,
            ShedStage::CoarsenMetrics | ShedStage::DropPackets => ShedStage::DropPackets,
        }
    }

    /// Whether this stage sacrifices *truth* (dropped packets), which must always
    /// be surfaced to the user (docs/05 §9, "never a silent lie").
    pub fn loses_truth(self) -> bool {
        matches!(self, ShedStage::DropPackets)
    }
}

/// Pre-computed integer occupancy thresholds for a given buffer capacity.
/// Eliminates floating-point comparisons and repeated recalculation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShedThresholds {
    pub t45: usize,
    pub t50: usize,
    pub t70: usize,
    pub t75: usize,
    pub t85: usize,
    pub t90: usize,
    pub t95: usize,
}

impl ShedThresholds {
    pub fn new(capacity: usize) -> Self {
        Self {
            t45: capacity * 45 / 100,
            t50: capacity * 50 / 100,
            t70: capacity * 70 / 100,
            t75: capacity * 75 / 100,
            t85: capacity * 85 / 100,
            t90: capacity * 90 / 100,
            t95: capacity * 95 / 100,
        }
    }
}

/// Stateful controller managing staged shedding hysteresis, persistent sampling,
/// and exact integer boundary transitions.
#[derive(Debug, Clone)]
pub struct ShedController {
    thresholds: ShedThresholds,
    stage: ShedStage,
    packet_counter: u64,
}

impl ShedController {
    pub fn new(capacity: usize) -> Self {
        Self {
            thresholds: ShedThresholds::new(capacity),
            stage: ShedStage::None,
            packet_counter: 0,
        }
    }

    pub fn current_stage(&self) -> ShedStage {
        self.stage
    }

    /// Update the current shedding stage based on integer buffer length and hysteresis thresholds.
    pub fn update(&mut self, current_len: usize) -> ShedStage {
        let t = &self.thresholds;
        let next = match self.stage {
            ShedStage::None => {
                if current_len >= t.t50 {
                    ShedStage::PayloadsOff
                } else {
                    ShedStage::None
                }
            }
            ShedStage::PayloadsOff => {
                if current_len >= t.t75 {
                    ShedStage::SampleDissection
                } else if current_len < t.t45 {
                    ShedStage::None
                } else {
                    ShedStage::PayloadsOff
                }
            }
            ShedStage::SampleDissection => {
                if current_len >= t.t90 {
                    ShedStage::CoarsenMetrics
                } else if current_len < t.t70 {
                    ShedStage::PayloadsOff
                } else {
                    ShedStage::SampleDissection
                }
            }
            ShedStage::CoarsenMetrics => {
                if current_len >= t.t95 {
                    ShedStage::DropPackets
                } else if current_len < t.t85 {
                    ShedStage::SampleDissection
                } else {
                    ShedStage::CoarsenMetrics
                }
            }
            ShedStage::DropPackets => {
                if current_len < t.t90 {
                    ShedStage::CoarsenMetrics
                } else {
                    ShedStage::DropPackets
                }
            }
        };
        self.stage = next;
        next
    }

    /// Returns true if this packet should be kept under 1-in-2 sample dissection.
    /// Uses a persistent counter across batches to prevent burst bias.
    pub fn should_sample(&mut self) -> bool {
        self.packet_counter = self.packet_counter.wrapping_add(1);
        self.packet_counter.is_multiple_of(2)
    }
}

/// Honest capture accounting (docs/05 §3, §9): every drop is counted so a
/// "no drop banner" can be trusted to mean "complete capture". Mirrors the
/// `CaptureStats` the trait exposes for live backends (docs/05 §5).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureStats {
    pub received: u64,
    /// Frames dropped by the kernel/driver ring + buffer eviction (truth loss).
    pub dropped: u64,
    #[serde(default)]
    pub shed_stage: ShedStage,
    #[serde(default)]
    pub buffer_frames: usize,
    #[serde(default)]
    pub buffer_capacity: usize,
}

impl CaptureStats {
    /// Fraction of frames dropped in `0.0..=1.0` (docs/05 §3 loss budget N1).
    pub fn drop_fraction(&self) -> f64 {
        let total = self.received + self.dropped;
        if total == 0 {
            0.0
        } else {
            self.dropped as f64 / total as f64
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shedding_is_ordered_detail_before_truth() {
        // Dropping packets is the last resort (docs/02 §8.3): ordered greatest.
        assert!(ShedStage::None < ShedStage::DropPackets);
        assert!(ShedStage::PayloadsOff < ShedStage::DropPackets);
        assert!(!ShedStage::PayloadsOff.loses_truth());
        assert!(ShedStage::DropPackets.loses_truth());
    }

    #[test]
    fn escalation_saturates_at_drop() {
        let mut s = ShedStage::None;
        for _ in 0..10 {
            s = s.escalate();
        }
        assert_eq!(s, ShedStage::DropPackets);
    }

    #[test]
    fn drop_fraction_is_honest() {
        let stats = CaptureStats {
            received: 996,
            dropped: 4,
            shed_stage: ShedStage::None,
            buffer_frames: 100,
            buffer_capacity: 50_000,
        };
        assert!((stats.drop_fraction() - 0.004).abs() < 1e-9);
        assert_eq!(CaptureStats::default().drop_fraction(), 0.0);
    }

    #[test]
    fn shed_controller_integer_thresholds_and_hysteresis() {
        let mut ctrl = ShedController::new(50_000);

        // At 24,999 (< 50%), stays None
        assert_eq!(ctrl.update(24_999), ShedStage::None);
        // At 25,000 (>= 50%), enters PayloadsOff
        assert_eq!(ctrl.update(25_000), ShedStage::PayloadsOff);

        // De-escalation hysteresis: at 23,000 (>= 45%), stays PayloadsOff
        assert_eq!(ctrl.update(23_000), ShedStage::PayloadsOff);
        // Below 22,500 (< 45%), returns to None
        assert_eq!(ctrl.update(22_499), ShedStage::None);

        // Escalate to SampleDissection at 37,500 (>= 75%)
        assert_eq!(ctrl.update(25_000), ShedStage::PayloadsOff);
        assert_eq!(ctrl.update(37_500), ShedStage::SampleDissection);

        // De-escalate hysteresis: at 36,000 (>= 70%), stays SampleDissection
        assert_eq!(ctrl.update(36_000), ShedStage::SampleDissection);
        // Below 35,000 (< 70%), returns to PayloadsOff
        assert_eq!(ctrl.update(34_999), ShedStage::PayloadsOff);
    }

    #[test]
    fn randomized_10000_operations_queue_invariant() {
        use std::collections::VecDeque;

        const MAX_FRAMES: usize = 1_000;
        let mut buffer: VecDeque<u64> = VecDeque::with_capacity(MAX_FRAMES);
        let mut ctrl = ShedController::new(MAX_FRAMES);
        let mut _total_received = 0u64;
        let mut buffer_drops = 0u64;

        // Deterministic pseudo-random sequence
        let mut seed = 123456789u64;
        let lcg = |s: &mut u64| -> u64 {
            *s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            *s
        };

        for i in 0..10_000 {
            let batch_size = ((lcg(&mut seed) % 200) + 1) as usize;
            let current_stage = ctrl.update(buffer.len() + batch_size);

            let needed = buffer.len() + batch_size;
            if needed > MAX_FRAMES {
                let overflow = needed - MAX_FRAMES;
                let to_drop = overflow.min(buffer.len());
                buffer.drain(0..to_drop);
                buffer_drops = buffer_drops.saturating_add(overflow as u64);
            }

            for j in 0..batch_size {
                _total_received += 1;
                let frame_id = i * 1000 + j as u64;
                if current_stage == ShedStage::SampleDissection && !ctrl.should_sample() {
                    continue;
                }
                buffer.push_back(frame_id);
            }

            // Invariant assertion after every operation
            assert!(
                buffer.len() <= MAX_FRAMES,
                "buffer capacity exceeded: {} > {}",
                buffer.len(),
                MAX_FRAMES
            );
        }

        assert!(buffer_drops > 0);
    }
}
