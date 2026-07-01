//! Unit tests for the core model invariants.

use netpulse_core::model::{Confidence, EvidenceRef, FindingCategory};
use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use std::net::{IpAddr, Ipv4Addr};

#[test]
fn confidence_clamps_out_of_range() {
    // Honesty principle: an invalid confidence must not be representable.
    assert_eq!(Confidence::new(1.5).value(), 1.0);
    assert_eq!(Confidence::new(-0.2).value(), 0.0);
    assert_eq!(Confidence::new(0.72).value(), 0.72);
}

#[test]
fn confidence_orders_by_value() {
    assert!(Confidence::new(0.3) < Confidence::new(0.9));
}

#[test]
fn five_tuple_equality_and_hashing() {
    let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let a = FiveTuple::new(ip, 4000, ip, 443, L4Proto::Tcp);
    let b = FiveTuple::new(ip, 4000, ip, 443, L4Proto::Tcp);
    let c = FiveTuple::new(ip, 4001, ip, 443, L4Proto::Tcp);
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn l7_defaults_to_unknown() {
    // NetPulse never guesses a protocol beyond the evidence.
    assert_eq!(L7Proto::default(), L7Proto::Unknown);
}

#[test]
fn evidence_ref_variants_are_distinct() {
    assert_ne!(EvidenceRef::Packet(1), EvidenceRef::Flow(1));
}

#[test]
fn finding_category_is_copy() {
    let cat = FindingCategory::Suspicious;
    let _also = cat; // Copy — no move error.
    assert_eq!(cat, FindingCategory::Suspicious);
}
