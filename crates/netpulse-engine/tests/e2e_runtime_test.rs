//! Deterministic full pipeline end-to-end smoke test for `netpulse-engine`.
//!
//! Validates the entire subsystem pipeline end-to-end:
//! Synthetic Frames -> LivePipeline -> Decode -> FlowEngine -> CaptureStore -> SQLite
//! -> Flush -> Reopen SQLite -> Hydration -> Referential Integrity -> Presentation View
//!
//! Invariants:
//! - All 6 entities survive process restart with exact canonical snapshot equality
//! - Narrative feed and monitor snapshot match between live ingestion and reloaded state

use std::net::{IpAddr, Ipv4Addr};

use netpulse_capture::CaptureStats;
use netpulse_core::traits::RawFrame;
use netpulse_core::{Depth, EvidenceRef, Finding, FindingCategory, Host};
use netpulse_engine::pipeline::{present, LivePipeline};
use netpulse_storage::capture_store::CaptureStore;
use netpulse_storage::PayloadPolicy;

fn make_ipv4_udp_dns_query(id: u16, name: &str) -> Vec<u8> {
    let mut pkt = Vec::new();
    // Ethernet (14 bytes)
    pkt.extend_from_slice(&[
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x08, 0x00,
    ]);
    // IPv4 header (20 bytes): 192.168.1.100 -> 1.1.1.1
    let total_len = 20 + 8 + 12 + name.len() + 2 + 4;
    pkt.extend_from_slice(&[
        0x45,
        0x00,
        (total_len >> 8) as u8,
        total_len as u8,
        0x00,
        0x01,
        0x40,
        0x00,
        0x40,
        0x11,
        0x00,
        0x00,
    ]);
    pkt.extend_from_slice(&[192, 168, 1, 100]);
    pkt.extend_from_slice(&[1, 1, 1, 1]);
    // UDP header (8 bytes): 53535 -> 53
    let udp_len = 8 + 12 + name.len() + 2 + 4;
    pkt.extend_from_slice(&53535u16.to_be_bytes());
    pkt.extend_from_slice(&53u16.to_be_bytes());
    pkt.extend_from_slice(&(udp_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00]); // checksum
                                          // DNS Header (12 bytes): ID, flags=0x0100 (standard query, RD), QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
    pkt.extend_from_slice(&id.to_be_bytes());
    pkt.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    // DNS Question Name (e.g. 3api7example3com0)
    for part in name.split('.') {
        pkt.push(part.len() as u8);
        pkt.extend_from_slice(part.as_bytes());
    }
    pkt.push(0); // root label
    pkt.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // QTYPE=A(1), QCLASS=IN(1)
    pkt
}

fn make_ipv4_udp_dns_response(id: u16, name: &str, resolved_ip: [u8; 4]) -> Vec<u8> {
    let mut pkt = Vec::new();
    // Ethernet (14 bytes)
    pkt.extend_from_slice(&[
        0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x08, 0x00,
    ]);
    // IPv4 header: 1.1.1.1 -> 192.168.1.100
    let total_len = 20 + 8 + 12 + name.len() + 2 + 4 + 2 + 2 + 2 + 4 + 2 + 4;
    pkt.extend_from_slice(&[
        0x45,
        0x00,
        (total_len >> 8) as u8,
        total_len as u8,
        0x00,
        0x02,
        0x40,
        0x00,
        0x40,
        0x11,
        0x00,
        0x00,
    ]);
    pkt.extend_from_slice(&[1, 1, 1, 1]);
    pkt.extend_from_slice(&[192, 168, 1, 100]);
    // UDP header: 53 -> 53535
    let udp_len = 8 + 12 + name.len() + 2 + 4 + 2 + 2 + 2 + 4 + 2 + 4;
    pkt.extend_from_slice(&53u16.to_be_bytes());
    pkt.extend_from_slice(&53535u16.to_be_bytes());
    pkt.extend_from_slice(&(udp_len as u16).to_be_bytes());
    pkt.extend_from_slice(&[0x00, 0x00]);
    // DNS Header: ID, flags=0x8180 (response, no error), QD=1, AN=1
    pkt.extend_from_slice(&id.to_be_bytes());
    pkt.extend_from_slice(&[0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
    // Question: name + type A + class IN
    for part in name.split('.') {
        pkt.push(part.len() as u8);
        pkt.extend_from_slice(part.as_bytes());
    }
    pkt.push(0);
    pkt.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);
    // Answer: pointer to question name (0xc00c), type A(1), class IN(1), TTL=300, rdlength=4, IP
    pkt.extend_from_slice(&[
        0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x01, 0x2c, 0x00, 0x04,
    ]);
    pkt.extend_from_slice(&resolved_ip);
    pkt
}

#[allow(clippy::too_many_arguments)]
fn make_ipv4_tcp_packet(
    src_ip: [u8; 4],
    src_port: u16,
    dst_ip: [u8; 4],
    dst_port: u16,
    seq: u32,
    ack: u32,
    flags: u8,
    payload: &[u8],
) -> Vec<u8> {
    let mut pkt = Vec::new();
    pkt.extend_from_slice(&[
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x08, 0x00,
    ]);
    let total_len = 20 + 20 + payload.len();
    pkt.extend_from_slice(&[
        0x45,
        0x00,
        (total_len >> 8) as u8,
        total_len as u8,
        0x00,
        0x03,
        0x40,
        0x00,
        0x40,
        0x06,
        0x00,
        0x00,
    ]);
    pkt.extend_from_slice(&src_ip);
    pkt.extend_from_slice(&dst_ip);
    pkt.extend_from_slice(&src_port.to_be_bytes());
    pkt.extend_from_slice(&dst_port.to_be_bytes());
    pkt.extend_from_slice(&seq.to_be_bytes());
    pkt.extend_from_slice(&ack.to_be_bytes());
    pkt.extend_from_slice(&[0x50, flags, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]);
    pkt.extend_from_slice(payload);
    pkt
}

#[tokio::test]
async fn test_e2e_runtime_pipeline_and_restart_durability() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("netpulse_e2e.db");

    // Initialize CaptureStore with SQLite persistence
    let mut store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    // LinkType 1 = Ethernet (DLT_EN10MB), 4 flow shards
    let mut pipeline = LivePipeline::new(1, 4);

    let client_ip = [192, 168, 1, 100];
    let server_ip = [93, 184, 216, 34];
    let client_port = 49152;
    let server_port = 443;

    // Batch 1: DNS Resolution Phase
    let f1 = RawFrame {
        mono_nanos: 1_000_000,
        iface_id: 1,
        bytes: make_ipv4_udp_dns_query(0xabcd, "api.example.com"),
    };
    let f2 = RawFrame {
        mono_nanos: 1_020_000,
        iface_id: 1,
        bytes: make_ipv4_udp_dns_response(0xabcd, "api.example.com", server_ip),
    };

    pipeline.ingest_batch(&[f1, f2]);
    pipeline.commit_to_store_async(&mut store, 2_000_000).await;

    // Batch 2: TCP Handshake + TLS ClientHello
    let syn = make_ipv4_tcp_packet(
        client_ip,
        client_port,
        server_ip,
        server_port,
        1000,
        0,
        0x02,
        &[],
    );
    let syn_ack = make_ipv4_tcp_packet(
        server_ip,
        server_port,
        client_ip,
        client_port,
        5000,
        1001,
        0x12,
        &[],
    );
    let ack = make_ipv4_tcp_packet(
        client_ip,
        client_port,
        server_ip,
        server_port,
        1001,
        5001,
        0x10,
        &[],
    );

    // TLS 1.2 ClientHello with SNI "api.example.com"
    let mut tls_hello = vec![
        0x16, 0x03, 0x01, 0x00, 0x5b, // Record header: Handshake, TLS 1.0, len 91
        0x01, 0x00, 0x00, 0x57, // ClientHello, len 87
        0x03, 0x03, // TLS 1.2
    ];
    tls_hello.extend_from_slice(&[0xaa; 32]); // Random
    tls_hello.push(0x00); // Session ID len
    tls_hello.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]); // Ciphers
    tls_hello.extend_from_slice(&[0x01, 0x00]); // Compressions
                                                // Extensions
    let sni_bytes = b"api.example.com";
    let ext_len = 2 + 2 + 2 + 1 + 2 + sni_bytes.len();
    tls_hello.extend_from_slice(&(ext_len as u16).to_be_bytes());
    tls_hello.extend_from_slice(&[0x00, 0x00]); // Ext type 0 (SNI)
    let server_name_list_len = (1 + 2 + sni_bytes.len()) as u16;
    tls_hello.extend_from_slice(&(server_name_list_len + 2).to_be_bytes());
    tls_hello.extend_from_slice(&server_name_list_len.to_be_bytes());
    tls_hello.push(0x00); // HostName type
    tls_hello.extend_from_slice(&(sni_bytes.len() as u16).to_be_bytes());
    tls_hello.extend_from_slice(sni_bytes);

    let client_hello_pkt = make_ipv4_tcp_packet(
        client_ip,
        client_port,
        server_ip,
        server_port,
        1001,
        5001,
        0x18,
        &tls_hello,
    );

    let f3 = RawFrame {
        mono_nanos: 2_000_000,
        iface_id: 1,
        bytes: syn,
    };
    let f4 = RawFrame {
        mono_nanos: 2_020_000,
        iface_id: 1,
        bytes: syn_ack,
    };
    let f5 = RawFrame {
        mono_nanos: 2_040_000,
        iface_id: 1,
        bytes: ack,
    };
    let f6 = RawFrame {
        mono_nanos: 2_050_000,
        iface_id: 1,
        bytes: client_hello_pkt,
    };

    pipeline.ingest_batch(&[f3, f4, f5, f6]);
    pipeline.commit_to_store_async(&mut store, 3_000_000).await;

    // Batch 3: Teardown & Finish
    let fin = make_ipv4_tcp_packet(
        client_ip,
        client_port,
        server_ip,
        server_port,
        1001 + tls_hello.len() as u32,
        5001,
        0x11,
        &[],
    );
    let fin_ack = make_ipv4_tcp_packet(
        server_ip,
        server_port,
        client_ip,
        client_port,
        5001,
        1002 + tls_hello.len() as u32,
        0x10,
        &[],
    );

    let f7 = RawFrame {
        mono_nanos: 3_000_000,
        iface_id: 1,
        bytes: fin,
    };
    let f8 = RawFrame {
        mono_nanos: 3_020_000,
        iface_id: 1,
        bytes: fin_ack,
    };

    pipeline.ingest_batch(&[f7, f8]);
    pipeline.finish_async(&mut store).await;

    // Enrich Host & Security Findings
    let host = Host {
        ip: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
        names: vec!["api.example.com".into()],
        geo: Some("US".into()),
        asn: Some(15133),
        org: Some("EDGECAST".into()),
    };
    store.insert_host_async(1, host).await;

    let target_flow_id = store.flows_in_window(0, u64::MAX)[0].id;
    let finding = Finding {
        id: 101,
        category: FindingCategory::Suspicious,
        confidence: netpulse_core::Confidence::new(0.85),
        evidence_refs: vec![EvidenceRef::Flow(target_flow_id)],
    };
    store.insert_finding_async(finding).await.unwrap();

    // Flush store to disk WAL
    store.flush_async().await.unwrap();

    // Take snapshot and presentation view prior to shutdown
    let before_snapshot = store.snapshot();
    let before_presentation = present(&store, Depth::Expert, CaptureStats::default());

    assert!(!before_snapshot.flows.is_empty(), "Flows exist");
    assert!(
        !before_snapshot.sessions.is_empty(),
        "Causal session exists"
    );
    assert!(!before_snapshot.hosts.is_empty(), "Host exists");
    assert!(!before_snapshot.findings.is_empty(), "Finding exists");
    assert!(
        !before_presentation.narratives.is_empty(),
        "Narrative cards generated"
    );

    // Close in-memory pipeline and drop store
    drop(pipeline);
    drop(store);

    // Hydrate freshly from SQLite
    let reloaded_store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    // Assert exact snapshot equality after process restart
    let after_snapshot = reloaded_store.snapshot();
    assert_eq!(
        before_snapshot, after_snapshot,
        "full database snapshot equality on restart"
    );

    // Assert presentation view generated from reloaded state matches original
    let after_presentation = present(&reloaded_store, Depth::Expert, CaptureStats::default());
    assert_eq!(
        before_presentation.narratives, after_presentation.narratives,
        "narratives match after restart"
    );
    assert_eq!(
        before_presentation.monitor.by_host, after_presentation.monitor.by_host,
        "monitor hosts match after restart"
    );
    assert_eq!(
        before_presentation.monitor.by_protocol, after_presentation.monitor.by_protocol,
        "monitor protocols match after restart"
    );
}
