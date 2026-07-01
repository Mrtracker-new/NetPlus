//! # netpulse-ai — the egress boundary
//!
//! The AI Explanation Service (docs/19): context distillation, grounding /
//! citation enforcement, and the pluggable backend trait (local runtime and
//! optional remote endpoint).
//!
//! **This is the only crate permitted outbound network access** (docs/02 §10).
//! Confining egress to one crate makes the privacy guarantee auditable:
//! verifying "no capture data leaves by default" reduces to inspecting this
//! boundary. The default backend is local (zero egress); a remote endpoint is
//! opt-in and sends only a minimized, distilled context, disclosed per request
//! (docs/01 §8.2, docs/19).
//!
//! Whichever backend, the service is *grounded*: fed structured evidence from
//! storage and constrained to cite it. It explains data; it never invents it
//! (docs/01 §7.5, docs/02 §6.3).
//!
//! **Status: foundation stub.** See Phase 4, docs/19.
#![forbid(unsafe_code)]

use netpulse_core::Result;

/// A pluggable explanation backend (docs/19). Local by default; remote is an
/// explicit, disclosed opt-in.
pub trait AiBackend {
    /// Stable backend identifier (e.g. "local-onnx", "remote-openai"),
    /// surfaced to the user so the active posture is always visible.
    fn id(&self) -> &'static str;

    /// True if using this backend causes any network egress. The UI uses this
    /// to disclose the privacy posture before a query runs.
    fn is_remote(&self) -> bool;

    /// Produce a grounded explanation for the distilled `context`. The backend
    /// must cite the provided evidence and add no facts of its own.
    ///
    /// TODO(phase4, docs/19): define the distilled-context and citation types.
    fn explain(&self, context: &str) -> Result<String>;
}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {}
}
