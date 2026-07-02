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

/// The staged shedding order (docs/02 §8.2, docs/05 §9), preferring to lose
/// *detail* before *truth*. Encoded as a first-class, testable type: a missing
/// payload costs depth, but a missing SYN/FIN corrupts a flow's state machine,
/// so detail is sacrificed first and truth-loss is always disclosed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ShedStage {
    /// Full fidelity — nothing shed.
    None,
    /// Stop storing payloads; keep headers + flow metrics.
    PayloadsOff,
    /// Fully dissect only a sample; count the rest into metrics.
    SampleDissection,
    /// Aggregate metrics at longer intervals.
    CoarsenMetrics,
    /// Last resort: drop at the kernel boundary, and *record* the drop.
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

/// Honest capture accounting (docs/05 §3, §9): every drop is counted so a
/// "no drop banner" can be trusted to mean "complete capture". Mirrors the
/// `CaptureStats` the trait exposes for live backends (docs/05 §5).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CaptureStats {
    pub received: u64,
    /// Frames dropped by the kernel/driver ring (truth loss).
    pub dropped: u64,
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
        };
        assert!((stats.drop_fraction() - 0.004).abs() < 1e-9);
        assert_eq!(CaptureStats::default().drop_fraction(), 0.0);
    }
}
