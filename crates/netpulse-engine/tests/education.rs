//! End-to-end Phase 3 education test. Reuses the Phase 1/2 golden
//! fixture — a DNS lookup for `example.com` followed by a TLS connection to the
//! resolved IP — and asserts the *education projection* over it: the grounded
//! lesson offers, the staged website journey, the protocol reference wired to
//! the learner's own data, and the data-driven handshake animation.
//!
//! Deterministic: no live network, no privileges. This is the "recorded capture
//! yields a known lesson, grounded in real values" test the Learning Engine
//! design calls for and the "golden journey" of.

use netpulse_core::Depth;
use netpulse_engine::education::{handshake_animation_for_flow, present_education};
use netpulse_engine::run_offline;
use netpulse_storage::{CaptureStore, PayloadPolicy};

const CLIENT: [u8; 4] = [192, 168, 0, 10];
const RESOLVER: [u8; 4] = [8, 8, 8, 8];
const SERVER: [u8; 4] = [93, 184, 216, 34];

fn eth_ipv4(proto: u8, src: [u8; 4], dst: [u8; 4], l4: &[u8]) -> Vec<u8> {
    let mut ip = vec![0x45, 0x00];
    let total = (20 + l4.len()) as u16;
    ip.extend_from_slice(&total.to_be_bytes());
    ip.extend_from_slice(&[0x00, 0x00, 0x40, 0x00, 0x40, proto, 0x00, 0x00]);
    ip.extend_from_slice(&src);
    ip.extend_from_slice(&dst);
    ip.extend_from_slice(l4);

    let mut frame = vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x08, 0x00];
    frame.extend_from_slice(&ip);
    frame
}

fn udp(src_port: u16, dst_port: u16, payload: &[u8]) -> Vec<u8> {
    let mut u = Vec::new();
    u.extend_from_slice(&src_port.to_be_bytes());
    u.extend_from_slice(&dst_port.to_be_bytes());
    u.extend_from_slice(&((payload.len() + 8) as u16).to_be_bytes());
    u.extend_from_slice(&[0, 0]);
    u.extend_from_slice(payload);
    u
}

fn tcp(src_port: u16, dst_port: u16, seq: u32, ack: u32, syn: bool, ack_f: bool) -> Vec<u8> {
    let mut t = Vec::new();
    t.extend_from_slice(&src_port.to_be_bytes());
    t.extend_from_slice(&dst_port.to_be_bytes());
    t.extend_from_slice(&seq.to_be_bytes());
    t.extend_from_slice(&ack.to_be_bytes());
    let mut flags: u16 = 5 << 12;
    if syn {
        flags |= 0x02;
    }
    if ack_f {
        flags |= 0x10;
    }
    t.extend_from_slice(&flags.to_be_bytes());
    t.extend_from_slice(&0xffffu16.to_be_bytes());
    t.extend_from_slice(&[0, 0, 0, 0]);
    t
}

fn dns_query(name: &str) -> Vec<u8> {
    let mut m = vec![0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
    for label in name.split('.') {
        m.push(label.len() as u8);
        m.extend_from_slice(label.as_bytes());
    }
    m.push(0);
    m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
    m
}

fn dns_response(name: &str, addr: [u8; 4]) -> Vec<u8> {
    let mut m = vec![0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0, 0, 0, 0];
    for label in name.split('.') {
        m.push(label.len() as u8);
        m.extend_from_slice(label.as_bytes());
    }
    m.push(0);
    m.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
    m.extend_from_slice(&[0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01]);
    m.extend_from_slice(&[0x00, 0x00, 0x01, 0x2c, 0x00, 0x04]);
    m.extend_from_slice(&addr);
    m
}

fn build_pcap(records: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(&0xa1b2c3d4u32.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&4u16.to_le_bytes());
    b.extend_from_slice(&0i32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&65535u32.to_le_bytes());
    b.extend_from_slice(&1u32.to_le_bytes());
    for (secs, frame) in records {
        b.extend_from_slice(&secs.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        b.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        b.extend_from_slice(frame);
    }
    b
}

fn session_pcap() -> Vec<u8> {
    let q = eth_ipv4(
        17,
        CLIENT,
        RESOLVER,
        &udp(50000, 53, &dns_query("example.com")),
    );
    let r = eth_ipv4(
        17,
        RESOLVER,
        CLIENT,
        &udp(53, 50000, &dns_response("example.com", SERVER)),
    );
    let syn = eth_ipv4(6, CLIENT, SERVER, &tcp(50001, 443, 100, 0, true, false));
    let synack = eth_ipv4(6, SERVER, CLIENT, &tcp(443, 50001, 900, 101, true, true));
    let ack = eth_ipv4(6, CLIENT, SERVER, &tcp(50001, 443, 101, 901, false, true));
    build_pcap(&[
        (1000, q),
        (1000, r),
        (1001, syn),
        (1001, synack),
        (1001, ack),
    ])
}

#[test]
fn the_capture_becomes_a_grounded_lesson() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).expect("pipeline runs");

    let view = present_education(&store, Depth::Beginner);

    // The DNS lookup in the fixture becomes a grounded lesson whose exercise
    // answer is the *actual* name looked up.
    let dns = view
        .offers
        .iter()
        .find(|o| o.lesson_id == "b3.dns")
        .expect("DNS lesson offered from the real lookup");
    assert!(dns.grounded, "grounded in the user's own capture");
    let ex = dns.exercise.as_ref().expect("a grounded check");
    assert_eq!(ex.answer, "example.com");

    // Every offer cites real evidence — no lesson without proof.
    assert!(view.offers.iter().all(|o| !o.evidence.is_empty()));
}

#[test]
fn the_journey_tells_the_page_load_story_in_order() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).unwrap();

    let view = present_education(&store, Depth::Intermediate);
    let journey = &view.journeys[0];

    // The staged story names the site and includes DNS + encryption stages.
    let kinds: Vec<&str> = journey.stages.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(kinds.first().copied(), Some("Navigation"));
    assert!(kinds.contains(&"DNS resolution"));
    assert!(kinds.contains(&"Encryption"));
    assert_eq!(kinds.last().copied(), Some("Completion"));
    assert!(journey.stages[0].narration.contains("example.com"));
}

#[test]
fn the_reference_links_back_to_the_users_own_flow() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).unwrap();

    let view = present_education(&store, Depth::Beginner);
    // The TLS entry reports the learner has a real example.
    let tls = view
        .reference
        .iter()
        .find(|e| e.key == "tls.sni")
        .expect("tls.sni is browsable");
    assert!(tls.examples_available);
}

#[test]
fn the_handshake_animation_uses_the_measured_rtt() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).unwrap();

    // The one TLS flow (id derived by the engine) has a measured RTT; the
    // animation's SYN-ACK lands at exactly that RTT.
    let flow_id = store
        .flows_in_window(0, u64::MAX)
        .iter()
        .find(|f| matches!(f.l7, netpulse_core::net::L7Proto::Tls))
        .map(|f| f.id)
        .expect("a TLS flow");
    let anim = handshake_animation_for_flow(&store, flow_id).expect("flow has RTT");
    let measured = store
        .flow(flow_id)
        .unwrap()
        .stats
        .rtt_estimate_nanos
        .unwrap();
    let syn_ack = anim.events.iter().find(|e| e.label == "SYN-ACK").unwrap();
    assert_eq!(syn_ack.at_nanos, measured);
    assert!(
        !anim.reduced_motion.is_empty(),
        "reduced-motion equivalent ships"
    );
}
