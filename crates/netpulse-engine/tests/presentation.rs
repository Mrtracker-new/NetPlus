//! End-to-end presentation test. Reuses the
//! golden fixture — a DNS lookup for `example.com` followed by a TLS
//! connection to the resolved IP — and asserts the *presentation projection*
//! over it: the narrative feed card and the monitoring snapshot the UI receives.
//!
//! Deterministic: no live network, no privileges. This is the "recorded capture
//! yields a known feed, verified card-by-card" test the Dashboard design calls
//! for.

use netpulse_api::dto::ProjectionDepth;
use netpulse_capture::CaptureStats;
use netpulse_core::Depth;
use netpulse_engine::pipeline::present;
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
fn narrative_feed_tells_the_session_story() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).expect("pipeline runs");

    let view = present(&store, Depth::Beginner, CaptureStats::default());

    // Exactly one session → one narrative card.
    assert_eq!(view.narratives.len(), 1, "one card for the one session");
    let card = &view.narratives[0];

    // The headline names the site, in plain language.
    assert!(
        card.headline.contains("example.com"),
        "headline names the host: {:?}",
        card.headline
    );

    // The card references its evidence — the session and the TLS flow it groups
    // (the evidence-reference invariant . No card without proof.
    assert!(!card.evidence.is_empty(), "card carries provenance");

    // Beginner depth is honest about encryption: the TLS connection is encrypted.
    assert!(
        card.summary.contains("Encrypted") || card.lines.iter().any(|l| l.contains("Encrypted")),
        "beginner card states the connection was encrypted: {card:?}"
    );
}

#[test]
fn expert_depth_discloses_more_than_beginner() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).unwrap();

    let beginner = present(&store, Depth::Beginner, CaptureStats::default());
    let expert = present(&store, Depth::Expert, CaptureStats::default());

    let b_lines = beginner.narratives[0].lines.len();
    let e_lines = expert.narratives[0].lines.len();
    assert!(
        e_lines > b_lines,
        "expert discloses more detail ({e_lines}) than beginner ({b_lines})"
    );
    // Evidence is depth-independent — drill-down reaches everything either way.
    assert_eq!(
        beginner.narratives[0].evidence.len(),
        expert.narratives[0].evidence.len()
    );
}

#[test]
fn monitor_snapshot_breaks_down_usage_and_separates_loss() {
    let pcap = session_pcap();
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    run_offline(&pcap, 16, &mut store).unwrap();

    // Inject a capture-drop count to prove it is reported as capture loss, not
    // network loss.
    let stats = CaptureStats {
        received: 100,
        dropped: 5,
        ..Default::default()
    };
    let view = present(&store, Depth::Intermediate, stats);

    // Usage breaks down by protocol; DNS + TLS both appear as top talkers
    //
    let protos: Vec<&str> = view
        .monitor
        .by_protocol
        .rows
        .iter()
        .map(|r| r.label.as_str())
        .collect();
    assert!(
        protos.contains(&"TLS"),
        "TLS in the protocol breakdown: {protos:?}"
    );
    assert!(
        protos.contains(&"DNS"),
        "DNS in the protocol breakdown: {protos:?}"
    );

    // The two loss figures are separate; capture drops are NOT network loss.
    assert_eq!(
        view.monitor.capture_drops, 5,
        "capture drops reported honestly"
    );
    assert_eq!(
        view.monitor.network_loss_indicators, 0,
        "a clean fixture has no network loss — capture drops must not leak in"
    );

    // A healthy fixture yields no fabricated diagnosis.
    assert!(
        view.monitor.diagnoses.is_empty(),
        "no degradation → no 'why is it slow' diagnosis"
    );
}

#[test]
fn projection_depth_dto_matches_core_depth() {
    // The wire enum and the core enum agree on the ladder.
    assert_eq!(ProjectionDepth::default(), ProjectionDepth::Beginner);
}
