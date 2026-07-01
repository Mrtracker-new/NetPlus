//! # netpulse-capture
//!
//! The capture-layer pipeline logic (docs/05): interface enumeration, feeding
//! the user-space ring buffer, timestamping, batching, and the staged-shedding
//! entry point (docs/02 §8). Uses [`netpulse_platform`] for the actual byte
//! source, so this crate stays platform-neutral.
//!
//! The golden rule (docs/02 §5.3): capture must never block on analysis. The
//! capture thread's only job is receive → timestamp → enqueue → return; when
//! downstream falls behind, a *named shedding policy* decides what to drop and
//! records it for honest disclosure to the user.
//!
//! **Status: foundation stub.** See Phase 1, docs/05.
#![forbid(unsafe_code)]

/// The staged shedding order (docs/02 §8.2), preferring to lose *detail* before
/// *truth*. Encoded now so the policy is a first-class, testable type rather
/// than emergent behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::ShedStage;

    #[test]
    fn shedding_is_ordered_detail_before_truth() {
        // Dropping packets is the last resort (docs/02 §8.3).
        assert_ne!(ShedStage::None, ShedStage::DropPackets);
    }
}
