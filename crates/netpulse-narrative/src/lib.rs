//! # netpulse-narrative — storytelling
//!
//! Transforms sessions into [`netpulse_core::Journey`] narratives: the
//! template/rule system that turns `ProtoEvent`s into human-language stories
//! (docs/09, docs/14). Purely a projection over the reconstruction model — it
//! holds no capture logic.
//!
//! Every narrative sentence will reference the ProtoEvents it summarizes,
//! upholding the evidence-reference invariant (docs/02 §6.3).
//!
//! **Status: foundation stub.** See Phase 2/3, docs/09 and docs/14.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {}
}
