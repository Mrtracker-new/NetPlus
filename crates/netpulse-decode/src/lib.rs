//! # netpulse-decode — the parser (security-critical)
//!
//! All protocol dissectors (docs/07): Ethernet/IP, TCP, UDP, DNS, TLS,
//! HTTP/1.1, HTTP/2, HTTP/3, QUIC — each implementing [`netpulse_core::Dissector`]
//! and producing [`netpulse_core::ProtoEvent`]s. Also owns the per-field
//! *explanation keys* (docs/07 §7) that unify the education system.
//!
//! **This crate is the primary attack surface.** It parses bytes controlled by
//! remote parties, so it depends only on `netpulse-core` and is treated as
//! hostile-input code: strict bounds checks, no `unsafe` without justification
//! and review, and a corresponding `fuzz/` target per dissector, gating CI
//! (docs/03 §3, docs/04 §3.4).
//!
//! **Status: foundation stub.** Dissector modules are placeholders until Phase 1.
#![forbid(unsafe_code)]

// Re-export the contract implementors will use, so downstream crates depend on
// the trait through its owning layer.
pub use netpulse_core::traits::Dissector;

// One module per dissector. Empty at foundation stage; each is fuzzed once
// implemented (docs/07, docs/04 §3.4).
mod eth {}
mod ip {}
mod tcp {}
mod udp {}
mod dns {}
mod tls {}
mod http1 {}
mod http2 {}
mod http3 {}
mod quic {}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {}
}
