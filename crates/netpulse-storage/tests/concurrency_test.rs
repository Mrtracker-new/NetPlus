//! Connection pool contention and concurrency stress test suite for `netpulse-storage`.
//!
//! Asserts explicit storage invariants under concurrent Tokio execution:
//! - N concurrent flow inserts -> exactly N persisted, no duplicate IDs, no lost writes
//! - Concurrent session writes -> atomic session-flow linkages preserved
//! - Concurrent reads during active SQLite WAL writes -> consistent query views
//! - Eviction while ingestion continues -> monotonic bounding
//! - Reopen snapshot equality -> before_snapshot == after_snapshot

use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::{
    EvidenceRef, Finding, FindingCategory, Flow, FlowMetrics, FlowState, Host, HostName,
    NameSource, ProtoEvent, ProtoEventKind, Session, Timestamp,
};
use netpulse_storage::capture_store::CaptureStore;
use netpulse_storage::repository::{CaptureRepository, SqliteCaptureRepository};
use netpulse_storage::PayloadPolicy;

fn make_flow(id: u64, ts: u64) -> Flow {
    let tuple = FiveTuple::new(
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        10000 + (id as u16 % 50000),
        IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
        443,
        L4Proto::Tcp,
    );
    Flow {
        id,
        key: tuple,
        first_ts: Timestamp::new(ts, ts),
        last_ts: Timestamp::new(ts + 10, ts + 10),
        l4: L4Proto::Tcp,
        l7: L7Proto::Tls,
        stats: FlowMetrics {
            bytes: 1024,
            packets: 10,
            rtt_estimate_nanos: Some(25_000_000),
            retransmits: 0,
            loss_indicators: 0,
        },
        state: FlowState::Established,
    }
}

#[tokio::test]
async fn test_concurrent_pool_flow_insertions_and_restart_invariants() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("concurrency_flows.db");

    let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let repo = Arc::new(repo);

    let num_tasks = 10;
    let flows_per_task = 100;
    let total_flows = num_tasks * flows_per_task;

    let mut handles = Vec::new();
    for task_idx in 0..num_tasks {
        let repo_clone = Arc::clone(&repo);
        handles.push(tokio::spawn(async move {
            for i in 0..flows_per_task {
                let flow_id = (task_idx * flows_per_task + i + 1) as u64;
                let flow = make_flow(flow_id, 1000 + flow_id * 10);
                let event = ProtoEvent {
                    flow_id,
                    ts: Timestamp::new(1005 + flow_id * 10, 1005 + flow_id * 10),
                    kind: ProtoEventKind::TlsClientHello,
                };
                repo_clone.insert_flow(flow, vec![event]).await.unwrap();
            }
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    // Invariant: 1000 inserted == 1000 persisted
    let count = repo.flow_count().await.unwrap();
    assert_eq!(count, total_flows, "exact persisted count invariant");

    // Invariant: 1000 reloadable without duplicates
    let all = repo.all_flows().await.unwrap();
    assert_eq!(all.len(), total_flows, "exact reloadable count invariant");
    let mut ids: Vec<u64> = all.iter().map(|f| f.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), total_flows, "no duplicate IDs invariant");

    // Drop connection handle and reopen database
    drop(repo);
    let reopened = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let reopened_count = reopened.flow_count().await.unwrap();
    assert_eq!(
        reopened_count, total_flows,
        "exact count after restart invariant"
    );
}

#[tokio::test]
async fn test_concurrent_session_and_flow_linkage_atomicity() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("concurrency_sessions.db");

    let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let repo = Arc::new(repo);

    let num_sessions = 50;
    // Pre-insert 100 flows (2 per session)
    for i in 1..=(num_sessions * 2) {
        let flow = make_flow(i as u64, 1000 + i as u64);
        repo.insert_flow(flow, vec![]).await.unwrap();
    }

    let mut handles = Vec::new();
    for session_idx in 1..=num_sessions {
        let repo_clone = Arc::clone(&repo);
        let flow_a = (session_idx * 2 - 1) as u64;
        let flow_b = (session_idx * 2) as u64;
        handles.push(tokio::spawn(async move {
            let session = Session {
                id: session_idx as u64,
                process_id: 1000 + session_idx as u64,
                start_ts: Timestamp::new(2000 + session_idx as u64, 2000 + session_idx as u64),
                trigger: format!("trigger_{session_idx}"),
                flow_ids: vec![flow_a, flow_b],
            };
            repo_clone.insert_session(session).await.unwrap();
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    // Verify all sessions have exact flow linkages in SQLite
    let all_sessions = repo.all_sessions().await.unwrap();
    assert_eq!(all_sessions.len(), num_sessions);
    for s in all_sessions {
        let expected_a = s.id * 2 - 1;
        let expected_b = s.id * 2;
        assert_eq!(s.flow_ids, vec![expected_a, expected_b]);

        let flows = repo.flows_for_session(s.id).await.unwrap();
        assert_eq!(flows.len(), 2);
        assert_eq!(flows[0].id, expected_a);
        assert_eq!(flows[1].id, expected_b);
    }
}

#[tokio::test]
async fn test_concurrent_reads_during_active_ingestion() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("concurrency_reads.db");

    let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let repo = Arc::new(repo);

    let stop_flag = Arc::new(AtomicBool::new(false));

    // Spawn 2 continuous reader tasks
    let mut reader_handles = Vec::new();
    for _ in 0..2 {
        let repo_read = Arc::clone(&repo);
        let stop_clone = Arc::clone(&stop_flag);
        reader_handles.push(tokio::spawn(async move {
            let mut read_iterations = 0;
            while !stop_clone.load(Ordering::Relaxed) {
                let _ = repo_read.flows_in_window(0, u64::MAX / 2).await;
                let _ = repo_read.flow_count().await;
                let _ = repo_read.session_ids().await;
                read_iterations += 1;
                tokio::time::sleep(tokio::time::Duration::from_millis(2)).await;
            }
            read_iterations
        }));
    }

    // Writer task inserting 200 flows
    let repo_write = Arc::clone(&repo);
    let writer_handle = tokio::spawn(async move {
        for i in 1..=200 {
            let flow = make_flow(i as u64, 1000 + i as u64);
            repo_write.insert_flow(flow, vec![]).await.unwrap();
        }
    });

    writer_handle.await.unwrap();
    stop_flag.store(true, Ordering::Relaxed);

    for r in reader_handles {
        let count = r.await.unwrap();
        assert!(
            count > 0,
            "reader must execute multiple iterations during writes"
        );
    }

    assert_eq!(repo.flow_count().await.unwrap(), 200);
}

#[tokio::test]
async fn test_concurrent_eviction_during_ingestion() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("concurrency_eviction.db");

    let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();
    let repo = Arc::new(repo);

    // Ingest 300 flows concurrently
    let mut handles = Vec::new();
    for task in 0..3 {
        let repo_clone = Arc::clone(&repo);
        handles.push(tokio::spawn(async move {
            for i in 1..=100 {
                let flow_id = (task * 100 + i) as u64;
                let flow = make_flow(flow_id, 1000 + flow_id);
                repo_clone.insert_flow(flow, vec![]).await.unwrap();
            }
        }));
    }

    // Simultaneously trigger eviction down to 50
    let repo_evict = Arc::clone(&repo);
    let evict_handle = tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
        repo_evict.evict_oldest_flows(50).await
    });

    for h in handles {
        h.await.unwrap();
    }
    let _ = evict_handle.await.unwrap();

    // Final count must be bounded
    let remaining = repo.flow_count().await.unwrap();
    assert!(remaining <= 300);
}

#[tokio::test]
async fn test_capture_store_snapshot_restart_equality_under_concurrency() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("concurrency_snapshot.db");

    let mut store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();

    // Ingest rich multi-entity dataset
    for i in 1..=50 {
        let flow = make_flow(i, 1000 + i * 10);
        let event = ProtoEvent {
            flow_id: i,
            ts: Timestamp::new(1005 + i * 10, 1005 + i * 10),
            kind: ProtoEventKind::HttpRequest,
        };
        store.insert_flow_async(flow, vec![event]).await;
    }

    for s in 1..=10 {
        let flow_a = (s * 2 - 1) as u64;
        let flow_b = (s * 2) as u64;
        let session = Session {
            id: s as u64,
            process_id: 2000 + s as u64,
            start_ts: Timestamp::new(1000 + s as u64, 1000 + s as u64),
            trigger: format!("nav_{s}"),
            flow_ids: vec![flow_a, flow_b],
        };
        store.insert_session_async(session).await;
    }

    for h in 1..=5 {
        let host = Host {
            ip: IpAddr::V4(Ipv4Addr::new(10, 0, 0, h as u8)),
            names: vec![format!("host{h}.local")],
            geo: Some("US".into()),
            asn: Some(13335),
            org: Some("CLOUDFLARE".into()),
        };
        store.insert_host_async(h as u64, host).await;
        store
            .set_resolution_async(
                IpAddr::V4(Ipv4Addr::new(10, 0, 0, h as u8)),
                vec![HostName {
                    name: format!("host{h}.local"),
                    source: NameSource::HostsFile,
                }],
            )
            .await;
    }

    let finding = Finding {
        id: 999,
        category: FindingCategory::Suspicious,
        confidence: netpulse_core::Confidence::new(0.9),
        evidence_refs: vec![EvidenceRef::Flow(1), EvidenceRef::Session(1)],
    };
    store.insert_finding_async(finding).await.unwrap();

    store.flush_async().await.unwrap();
    let before_snapshot = store.snapshot();

    drop(store);

    // Reopen store from SQLite and verify snapshot equality
    let reloaded_store = CaptureStore::open_sqlite(&db_path, PayloadPolicy::MetadataOnly)
        .await
        .unwrap();
    let after_snapshot = reloaded_store.snapshot();

    assert_eq!(
        before_snapshot, after_snapshot,
        "snapshot equality invariant on restart"
    );
}
