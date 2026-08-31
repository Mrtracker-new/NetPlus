//! Stepwise component integration test suite for `netpulse-engine`.
//!
//! Validates each stage of the pipeline independently before end-to-end integration:
//! 1. `test_decode_to_packet_view`: Byte dissection -> `PacketView`
//! 2. `test_packet_view_to_flow_engine`: `PacketView` -> `FlowEngine`
//! 3. `test_flow_engine_to_capture_store`: `FlowEngine` -> `CaptureStore` (in-memory)
//! 4. `test_capture_store_to_sqlite`: `CaptureStore` -> SQLite durability
//! 5. `test_sqlite_restart_hydration`: SQLite -> `CaptureStore` hydration & snapshot equality
//! 6. `test_hydrated_store_to_presentation`: Hydrated `CaptureStore` -> Presentation narratives & monitor

use std::net::{IpAddr, Ipv4Addr};

use netpulse_capture::CaptureStats;
use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::{
    Depth, EvidenceRef, Finding, FindingCategory, Flow, FlowMetrics, FlowState, Host, HostName,
    NameSource, ProtoEvent, ProtoEventKind, Session, Timestamp,
};
use netpulse_decode::frame::{LinkKind, Transport};
use netpulse_decode::{decode_frame, LinkType};
use netpulse_flow::{FlowEngine, PacketView};
use netpulse_storage::capture_store::CaptureStore;
use netpulse_storage::repository::SqliteCaptureRepository;
use netpulse_storage::PayloadPolicy;

use netpulse_engine::pipeline::present;

// Helper: Synthesize a raw Ethernet+IPv4+TCP packet
fn make_tcp_packet(
    src_ip: [u8; 4],
    src_port: u16,
    dst_ip: [u8; 4],
    dst_port: u16,
    flags: u8,
) -> Vec<u8> {
    let mut pkt = Vec::new();
    // Ethernet header: dst(6), src(6), type=0x0800
    pkt.extend_from_slice(&[
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x08, 0x00,
    ]);
    // IPv4 header (20 bytes): ver/ihl=0x45, tos=0, len=40, id=1, flags/frag=0x4000, ttl=64, proto=6(TCP), csum=0, src, dst
    pkt.extend_from_slice(&[
        0x45, 0x00, 0x00, 0x28, 0x00, 0x01, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00,
    ]);
    pkt.extend_from_slice(&src_ip);
    pkt.extend_from_slice(&dst_ip);
    // TCP header (20 bytes): src_port, dst_port, seq=1000, ack=0, offset=0x50, flags, win=65535, csum=0, urg=0
    pkt.extend_from_slice(&src_port.to_be_bytes());
    pkt.extend_from_slice(&dst_port.to_be_bytes());
    pkt.extend_from_slice(&1000u32.to_be_bytes()); // seq
    pkt.extend_from_slice(&0u32.to_be_bytes()); // ack
    pkt.extend_from_slice(&[0x50, flags, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]);
    pkt
}

#[test]
fn test_stage1_decode_to_packet_view() {
    let raw = make_tcp_packet([192, 168, 1, 50], 45678, [93, 184, 216, 34], 443, 0x02); // SYN
    let decoded = decode_frame(LinkType::Ethernet, &raw);

    assert_eq!(decoded.link, LinkKind::Ethernet);
    assert!(decoded.network.is_some());
    assert!(matches!(decoded.transport, Some(Transport::Tcp(_))));

    let ts = Timestamp::new(1_000_000, 1_000_000);
    let pv = PacketView::from_decoded(ts, &decoded).expect("PacketView from decoded");

    assert_eq!(pv.tuple.src_ip, IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50)));
    assert_eq!(pv.tuple.src_port, 45678);
    assert_eq!(pv.tuple.dst_ip, IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)));
    assert_eq!(pv.tuple.dst_port, 443);
    assert_eq!(pv.tuple.l4, L4Proto::Tcp);
    assert!(pv.tcp.as_ref().unwrap().syn);
    assert!(!pv.tcp.as_ref().unwrap().ack);
}

#[test]
fn test_stage2_packet_view_to_flow_engine() {
    let mut engine = FlowEngine::new(4);

    // 1. DNS Response packet resolving 93.184.216.34 to "example.com"
    let dns_pv = PacketView {
        ts: Timestamp::new(500_000, 500_000),
        tuple: FiveTuple::new(
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            53,
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50)),
            54321,
            L4Proto::Udp,
        ),
        l7: L7Proto::Dns,
        payload_len: 64,
        tcp: None,
        events: vec![ProtoEventKind::DnsResponse],
        dns_resolutions: vec![netpulse_flow::DnsResolution {
            name: "example.com".into(),
            addr: IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
        }],
        sni: None,
    };
    engine.ingest(&dns_pv);

    // 2. Forward SYN: client -> server
    let raw_syn = make_tcp_packet([192, 168, 1, 50], 45678, [93, 184, 216, 34], 443, 0x02);
    let decoded_syn = decode_frame(LinkType::Ethernet, &raw_syn);
    let ts1 = Timestamp::new(1_000_000, 1_000_000);
    let pv1 = PacketView::from_decoded(ts1, &decoded_syn).unwrap();
    engine.ingest(&pv1);

    // 3. Reverse SYN-ACK: server -> client (must map to same flow canonical key)
    let raw_synack = make_tcp_packet([93, 184, 216, 34], 443, [192, 168, 1, 50], 45678, 0x12); // SYN | ACK
    let decoded_synack = decode_frame(LinkType::Ethernet, &raw_synack);
    let ts2 = Timestamp::new(1_020_000, 1_020_000);
    let pv2 = PacketView::from_decoded(ts2, &decoded_synack).unwrap();
    engine.ingest(&pv2);

    // 4. Forward ACK: client -> server (completing 3-way handshake to Established)
    let raw_ack = make_tcp_packet([192, 168, 1, 50], 45678, [93, 184, 216, 34], 443, 0x10); // ACK
    let decoded_ack = decode_frame(LinkType::Ethernet, &raw_ack);
    let ts3 = Timestamp::new(1_030_000, 1_030_000);
    let pv3 = PacketView::from_decoded(ts3, &decoded_ack).unwrap();
    engine.ingest(&pv3);

    let (flows, sessions) = engine.finish();
    assert_eq!(flows.len(), 2, "1 DNS flow + 1 TCP flow");
    let tcp_flow = flows.iter().find(|f| f.flow.l4 == L4Proto::Tcp).unwrap();
    assert_eq!(tcp_flow.flow.state, FlowState::Established);
    assert_eq!(sessions.len(), 1, "session created via DNS lineage");
    assert!(sessions[0].flow_ids.contains(&tcp_flow.flow.id));
}

#[test]
fn test_stage3_flow_engine_to_capture_store_in_memory() {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);

    let flow = Flow {
        id: 42,
        key: FiveTuple::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            12345,
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            443,
            L4Proto::Tcp,
        ),
        first_ts: Timestamp::new(100, 100),
        last_ts: Timestamp::new(200, 200),
        l4: L4Proto::Tcp,
        l7: L7Proto::Tls,
        stats: FlowMetrics::default(),
        state: FlowState::Established,
    };
    let event = ProtoEvent {
        flow_id: 42,
        ts: Timestamp::new(150, 150),
        kind: ProtoEventKind::TlsClientHello,
    };
    store.insert_flow(flow, vec![event]);

    let session = Session {
        id: 7,
        process_id: 100,
        start_ts: Timestamp::new(100, 100),
        trigger: "stage3_test".into(),
        flow_ids: vec![42],
    };
    store.insert_session(session);

    assert_eq!(store.flow_count(), 1);
    assert_eq!(store.session_count(), 1);
    assert_eq!(store.flows_for_session(7).len(), 1);
    assert_eq!(store.events_for_flow(42).len(), 1);
}

#[tokio::test]
async fn test_stage4_capture_store_to_sqlite() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("stage4.db");

    let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let mut store = CaptureStore::with_repository(PayloadPolicy::MetadataOnly, repo);

    let flow = Flow {
        id: 100,
        key: FiveTuple::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            50000,
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            53,
            L4Proto::Udp,
        ),
        first_ts: Timestamp::new(1000, 1000),
        last_ts: Timestamp::new(1010, 1010),
        l4: L4Proto::Udp,
        l7: L7Proto::Dns,
        stats: FlowMetrics::default(),
        state: FlowState::Datagram,
    };
    let event = ProtoEvent {
        flow_id: 100,
        ts: Timestamp::new(1005, 1005),
        kind: ProtoEventKind::DnsQuery,
    };
    store.insert_flow_async(flow, vec![event]).await;

    let session = Session {
        id: 10,
        process_id: 200,
        start_ts: Timestamp::new(1000, 1000),
        trigger: "stage4_dns".into(),
        flow_ids: vec![100],
    };
    store.insert_session_async(session).await;

    store
        .set_resolution_async(
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            vec![HostName {
                name: "one.one.one.one".into(),
                source: NameSource::Dns,
            }],
        )
        .await;

    let finding = Finding {
        id: 55,
        category: FindingCategory::Suspicious,
        confidence: netpulse_core::Confidence::new(0.8),
        evidence_refs: vec![EvidenceRef::Flow(100), EvidenceRef::Session(10)],
    };
    store.insert_finding_async(finding).await.unwrap();

    store.flush_async().await.unwrap();

    let snap = store.snapshot();
    assert_eq!(snap.flows.len(), 1);
    assert_eq!(snap.sessions.len(), 1);
    assert_eq!(snap.proto_events.len(), 1);
    assert_eq!(snap.resolutions.len(), 1);
    assert_eq!(snap.findings.len(), 1);
}

#[tokio::test]
async fn test_stage5_sqlite_restart_hydration_equality() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("stage5.db");

    let mut store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    let flow = Flow {
        id: 77,
        key: FiveTuple::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            60000,
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            53,
            L4Proto::Udp,
        ),
        first_ts: Timestamp::new(500, 500),
        last_ts: Timestamp::new(510, 510),
        l4: L4Proto::Udp,
        l7: L7Proto::Dns,
        stats: FlowMetrics::default(),
        state: FlowState::Datagram,
    };
    let event = ProtoEvent {
        flow_id: 77,
        ts: Timestamp::new(505, 505),
        kind: ProtoEventKind::DnsResponse,
    };
    store.insert_flow_async(flow, vec![event]).await;

    let session = Session {
        id: 33,
        process_id: 400,
        start_ts: Timestamp::new(500, 500),
        trigger: "dns_lookup".into(),
        flow_ids: vec![77],
    };
    store.insert_session_async(session).await;

    let host = Host {
        ip: IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
        names: vec!["dns.google".into()],
        geo: Some("US".into()),
        asn: Some(15169),
        org: Some("GOOGLE".into()),
    };
    store.insert_host_async(1, host).await;

    store.flush_async().await.unwrap();
    let before_snapshot = store.snapshot();
    drop(store);

    // Reopen from SQLite
    let reloaded = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();
    let after_snapshot = reloaded.snapshot();

    assert_eq!(
        before_snapshot, after_snapshot,
        "full snapshot restart equality"
    );
}

#[tokio::test]
async fn test_stage6_hydrated_store_to_presentation() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("stage6.db");

    let mut store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    let flow = Flow {
        id: 200,
        key: FiveTuple::new(
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            44444,
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            443,
            L4Proto::Tcp,
        ),
        first_ts: Timestamp::new(1000, 1000),
        last_ts: Timestamp::new(2000, 2000),
        l4: L4Proto::Tcp,
        l7: L7Proto::Tls,
        stats: FlowMetrics {
            bytes: 5000,
            packets: 20,
            rtt_estimate_nanos: Some(30_000_000),
            retransmits: 0,
            loss_indicators: 0,
        },
        state: FlowState::Established,
    };
    store.insert_flow_async(flow, vec![]).await;

    let session = Session {
        id: 99,
        process_id: 1234,
        start_ts: Timestamp::new(1000, 1000),
        trigger: "User visited example.com".into(),
        flow_ids: vec![200],
    };
    store.insert_session_async(session).await;

    store
        .set_resolution_async(
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            vec![HostName {
                name: "example.com".into(),
                source: NameSource::Sni,
            }],
        )
        .await;

    store.flush_async().await.unwrap();
    drop(store);

    // Hydrate from SQLite and generate presentation views
    let hydrated_store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    let view = present(&hydrated_store, Depth::Expert, CaptureStats::default());
    assert_eq!(view.narratives.len(), 1, "exactly 1 narrative card created");
    assert!(!view.narratives[0].headline.is_empty());
    assert_eq!(view.monitor.by_host.rows.len(), 1);
    assert_eq!(view.monitor.by_host.rows[0].bytes, 5000);
}

#[test]
fn test_high_throughput_zero_false_drops_and_healthy_diagnostics() {
    use netpulse_capture::ShedStage;
    use netpulse_core::traits::RawFrame;
    use netpulse_engine::pipeline::LivePipeline;

    let mut pipeline = LivePipeline::new(1, 16); // DLT_EN10MB = 1
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);

    let raw_bytes = make_tcp_packet([10, 0, 0, 1], 12345, [10, 0, 0, 2], 80, 0x18); // PSH+ACK
    let frames: Vec<RawFrame> = (0..1000)
        .map(|i| RawFrame {
            mono_nanos: i as u64 * 1_000_000,
            iface_id: 1,
            bytes: raw_bytes.clone(),
        })
        .collect();

    // Ingest 100 batches of 1,000 frames = 100,000 total frames
    for batch_idx in 0..100 {
        pipeline.ingest_batch(&frames);
        if batch_idx % 10 == 0 {
            pipeline.commit_to_store(&mut store, (batch_idx as u64 + 1) * 1_000_000_000);
        }
    }
    pipeline.finish(&mut store);

    let stats = CaptureStats {
        received: 100_000,
        dropped: 0,
        shed_stage: ShedStage::None,
        buffer_frames: 0,
        buffer_capacity: 0,
    };

    let view = present(&store, Depth::Expert, stats);

    // Assert that capture drops remain exactly zero
    assert_eq!(view.monitor.capture_drops, 0);
    let cs = view
        .monitor
        .capture_stats
        .as_ref()
        .expect("capture stats present");
    assert_eq!(cs.dropped, 0);
    assert_eq!(cs.shed_stage, netpulse_api::dto::ShedStageDto::None);
    assert_eq!(cs.buffer_frames, 0);
    assert_eq!(cs.buffer_capacity, 0);

    let chain = view
        .monitor
        .diagnostic_chain
        .as_ref()
        .expect("diagnostic chain present");

    // Assert Device (Local Stack) is Healthy (not Degraded)
    let device_stage = chain
        .stages
        .iter()
        .find(|s| s.stage == netpulse_api::dto::DiagnosticChainStageKindDto::Device)
        .expect("Device stage present in chain");
    assert_eq!(
        device_stage.status,
        netpulse_api::dto::DiagnosticStageStatusDto::Healthy
    );

    // Assert Interface is Healthy (not Degraded)
    let iface_stage = chain
        .stages
        .iter()
        .find(|s| s.stage == netpulse_api::dto::DiagnosticChainStageKindDto::Interface)
        .expect("Interface stage present in chain");
    assert_eq!(
        iface_stage.status,
        netpulse_api::dto::DiagnosticStageStatusDto::Healthy
    );
}
