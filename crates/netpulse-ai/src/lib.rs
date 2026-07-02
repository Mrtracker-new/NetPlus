//! # netpulse-ai — the egress boundary (Phase 4)
//!
//! The AI Explanation Service (docs/19): a *grounded* natural-language layer that
//! **explains** the user's captured data and never replaces or invents it
//! (docs/01 AI section, docs/19 §3). The pipeline is retrieval-first: gather the
//! user's real evidence ([`assistant`]), distill it into a compact structured
//! [`context::DistilledContext`], ask a pluggable [`backend::AiBackend`] to
//! explain *that*, and validate every citation against the store before returning
//! (docs/19 §12). Grounding is *checked, not trusted*.
//!
//! **This is the only crate permitted outbound network access** (docs/02 §10).
//! Confining egress here makes the privacy guarantee auditable: the sole thing
//! that could ever leave the device is a distilled context, and exactly what it
//! discloses is inspectable via
//! [`DistilledContext::disclosure_preview`](context::DistilledContext::disclosure_preview)
//! before any send (docs/19 §4.3). The default backend
//! ([`backend::LocalTemplateBackend`]) does **zero** egress, so NetPulse is fully
//! explanatory offline; a remote endpoint is an explicit, disclosed opt-in
//! (docs/19 §4.1–4.2).
#![forbid(unsafe_code)]

pub mod assistant;
pub mod backend;
pub mod context;

pub use assistant::{Assistant, GroundedAnswer};
pub use backend::{AiBackend, LocalTemplateBackend};
pub use context::{DistilledContext, Fact, Intent};

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_storage::{CaptureStore, PayloadPolicy};

    /// The whole crate links: a local assistant answers over an empty store with
    /// an honest decline and zero egress (docs/19 §3, §4.1).
    #[test]
    fn crate_links() {
        let store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let a = Assistant::local().answer(&store, "what happened?");
        assert!(!a.is_remote);
        assert!(!a.grounded); // nothing captured → honest decline
    }
}
