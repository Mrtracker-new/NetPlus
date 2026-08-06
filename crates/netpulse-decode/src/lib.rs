//! # netpulse-decode — the parser (security-critical)
//!
//! All protocol dissectors: Ethernet/IP, TCP, UDP, DNS, TLS, and
//! plaintext HTTP/1.1 — parsed into structured [`Decoded`] output and coarse
//! [`netpulse_core::ProtoEventKind`] landmarks. Also owns the per-field
//! *explanation keys* that unify the education system.
//!
//! **This crate is the primary attack surface.** It parses bytes controlled by
//! remote parties, so it depends only on `netpulse-core` and is treated as
//! hostile-input code:
//! - every read goes through the bounds-checked [`reader::Reader`] — no
//!   over-reads, no panics on truncated input;
//! - recursive/repetitive structures (DNS name compression, TLS extensions) have
//!   hard caps to defuse decompression-loop / pointer-loop DoS;
//! - no `unsafe`; the crate is `#![forbid(unsafe_code)]`.
//!
//! The top-level entry point is [`decode_frame`]; it never fails, returning a
//! partial [`Decoded`] when a deeper layer cannot parse.
//!
//! ## Scope of the Phase 1 slice
//! Implemented: link (Ethernet/loopback), IPv4/IPv6, TCP, UDP, DNS, TLS
//! ClientHello/ServerHello (SNI + ALPN), plaintext HTTP/1.1. Deep TLS records
//! beyond the handshake, HTTP/2, HTTP/3, and QUIC framing are honestly hinted
//! but left for later passes.
#![forbid(unsafe_code)]

pub mod dns;
pub mod explain;
pub mod frame;
pub mod http;
pub mod layers;
pub mod pipeline;
pub mod reader;
pub mod tls;

// Re-export the contract implementors use, so downstream crates depend on the
// trait through its owning layer.
pub use netpulse_core::traits::Dissector;

pub use explain::{explain, DisclosureDepth, Explanation, ExplanationKey, ALL_KEYS};
pub use frame::{
    Decoded, DnsAnswer, DnsInfo, DnsQuestion, HttpInfo, L7Detail, LinkKind, NetworkHeader,
    TcpFlags, TcpHeader, TlsInfo, Transport, UdpHeader,
};
pub use pipeline::{decode_frame, LinkType};
pub use reader::Reader;
