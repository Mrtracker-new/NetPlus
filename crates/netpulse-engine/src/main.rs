//! # netpulse-engine
//!
//! The analysis process (docs/02 §5.1, docs/04 §3.12). It wires the pipeline —
//! decode → flow → narrative → storage → intel → ai/learn — and serves the
//! Query/Stream API to the UI. Runs at user privilege; it holds no raw-capture
//! capability (that lives in the separate `netpulse-capture-svc` process).
//!
//! **Status: foundation stub.** Wiring lands across Phases 1–4. For now `main`
//! confirms every layer links and the binary starts cleanly (N8: fast startup).
#![forbid(unsafe_code)]

fn main() {
    println!(
        "NetPulse engine v{} — foundation scaffold. \
         Query/Stream API v{}. Pipeline wiring: Phase 1+ (see docs/02, docs/05).",
        env!("CARGO_PKG_VERSION"),
        netpulse_api::API_VERSION,
    );
    // Reference lower layers so the full dependency graph is exercised and the
    // storage default (privacy-preserving) is asserted at startup.
    debug_assert_eq!(
        netpulse_storage::PayloadPolicy::default(),
        netpulse_storage::PayloadPolicy::MetadataOnly,
    );
}
