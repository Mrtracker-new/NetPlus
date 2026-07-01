//! # netpulse-intel — security + anomaly
//!
//! The [`Detector`] implementations (rules and heuristics, docs/17, docs/18)
//! and anomaly scoring (statistical + ONNX inference, docs/20). Emits
//! [`netpulse_core::Finding`]s with confidence + evidence references.
//!
//! Runs *off the hot path* (docs/02 §5.2): it consumes committed data from
//! storage so heavy analysis never back-pressures capture. Honesty is
//! structural here — a finding always carries calibrated confidence and links
//! to its evidence; a bare verdict is impossible to construct (docs/01 §7.2).
//!
//! **Status: foundation stub.** See Phase 4, docs/17, docs/18, docs/20.
#![forbid(unsafe_code)]

pub use netpulse_core::traits::Detector;

// Rule/heuristic detectors (docs/17, docs/18) and anomaly scoring (docs/20).
mod rules {}
mod anomaly {}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {}
}
