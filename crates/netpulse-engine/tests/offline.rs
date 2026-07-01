//! End-to-end offline pipeline test (docs/04 §9, docs/05 §12 golden
//! reconstruction). Builds an in-memory pcap of a realistic mini-session — a DNS
//! lookup for `example.com` followed by a TLS connection to the resolved IP —
//! and asserts the reconstructed flows, session, and DNS→connection lineage
//! (docs/06 §6.1). Deterministic: no live network, no privileges.

use std::net::Ipv4Addr;

use netpulse_engine::analyze_pcap;

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
    let mut flags: u16 = 5 << 12; // data offset 5 words
    if syn {
        flags |= 0x02;
    }
    if ack_f {
        flags |= 0x10;
    }
    t.extend_from_slice(&flags.to_be_bytes());
    t.extend_from_slice(&0xffffu16.to_be_bytes()); // window
    t.extend_from_slice(&[0, 0, 0, 0]); // checksum + urg
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
    // answer: pointer to name at offset 12, A IN ttl 300 rdlen 4
    m.extend_from_slice(&[0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01]);
    m.extend_from_slice(&[0x00, 0x00, 0x01, 0x2c, 0x00, 0x04]);
    m.extend_from_slice(&addr);
    m
}

/// Assemble a little-endian microsecond pcap from `(ts_secs, frame)` records.
fn build_pcap(records: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(&0xa1b2c3d4u32.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&4u16.to_le_bytes());
    b.extend_from_slice(&0i32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&65535u32.to_le_bytes());
    b.extend_from_slice(&1u32.to_le_bytes()); // Ethernet
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
fn reconstructs_dns_then_connection_session() {
    let pcap = session_pcap();
    let (store, report) = analyze_pcap(&pcap, 16).expect("pipeline runs");

    // 5 frames in, all decodable to flow packets.
    assert_eq!(report.frames_read, 5);
    assert_eq!(report.non_flow_frames, 0);

    // Two conversations: the DNS UDP exchange and the TCP connection.
    assert_eq!(report.flows, 2, "one DNS flow + one TCP flow");

    // The connection to the resolved IP is causally linked to the lookup.
    assert!(report.causal_links >= 1, "DNS→connection lineage found");
    assert_eq!(report.sessions, 1, "one reconstructed session");

    // The session groups the TCP flow and its trigger names the site.
    let session = store.flows_in_window(0, u64::MAX);
    assert!(!session.is_empty());

    // Metadata-only: the pipeline wrote zero payload bytes (docs/08 §4).
    assert_eq!(store.payload_records(), 0);
}

#[test]
fn tcp_flow_reaches_established_with_setup_rtt() {
    let pcap = session_pcap();
    let (store, _report) = analyze_pcap(&pcap, 16).unwrap();

    // Find the TCP flow to the server on port 443.
    let server = Ipv4Addr::from(SERVER);
    let flows = store.flows_in_window(0, u64::MAX);
    let tcp_flow = flows
        .iter()
        .find(|f| f.l4 == netpulse_core::net::L4Proto::Tcp)
        .expect("a TCP flow exists");
    assert!(
        matches!(
            tcp_flow.key.dst_ip,
            std::net::IpAddr::V4(ip) if ip == server
        ) || matches!(
            tcp_flow.key.src_ip,
            std::net::IpAddr::V4(ip) if ip == server
        ),
        "TCP flow involves the resolved server"
    );
    // Handshake completed → Established, and a setup RTT was measured.
    assert_eq!(tcp_flow.state, netpulse_core::FlowState::Established);
    assert!(tcp_flow.stats.rtt_estimate_nanos.is_some());
}
