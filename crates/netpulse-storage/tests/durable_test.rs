//! Durable persistence acceptance tests.
//!
//! These are the tests the storage layer was missing: they assert that a write
//! made through the *store* actually reaches SQLite and is readable after a
//! reconnect. Before the durable mirror existed, the synchronous store write path
//! resolved to a no-op trait default and every write was silently dropped while
//! `insert_flow` returned `()`; nothing failed and nothing persisted.

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::{Flow, FlowMetrics, FlowState, Session, Timestamp};
use netpulse_storage::{CaptureStore, DurableLog, PayloadPolicy, Store};

fn flow(id: u64, ts: u64) -> Flow {
    let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
    Flow {
        id,
        key: FiveTuple::new(ip, 1, ip, 2, L4Proto::Tcp),
        first_ts: Timestamp::new(ts, ts),
        last_ts: Timestamp::new(ts + 1, ts + 1),
        l4: L4Proto::Tcp,
        l7: L7Proto::Tls,
        stats: FlowMetrics::default(),
        state: FlowState::Closed,
    }
}

#[test]
fn store_writes_are_readable_after_reconnect() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("capture.db");

    {
        let (log, snapshot) = DurableLog::open(&db).expect("open durable log");
        assert!(snapshot.flows.is_empty(), "fresh database must start empty");

        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.attach_durable_log(log);
        assert!(store.is_durable(), "store must report durable backing");

        store
            .insert_flow(flow(1, 1_000), vec![])
            .expect("flow write must be accepted");
        store
            .insert_session(Session {
                id: 1,
                process_id: 0,
                start_ts: Timestamp::new(1_000, 1_000),
                trigger: "test session".into(),
                flow_ids: vec![1],
            })
            .expect("session write must be accepted");

        // A flush is the barrier the shutdown path relies on: it returns only
        // once every queued write has been attempted, and fails if any of them
        // did not succeed.
        store
            .flush_durable(Duration::from_secs(10))
            .expect("flush must report success only when every write is durable");

        let health = store.durable_health().expect("health must be reported");
        assert_eq!(health.failed, 0, "no write may fail: {health:?}");
        assert!(
            health.applied >= 2,
            "both records must have been applied: {health:?}"
        );
        assert!(health.path.ends_with("capture.db"), "{health:?}");

        let final_health = store.shutdown_durable().expect("mirror must be joined");
        assert!(final_health.is_healthy(), "{final_health:?}");
    }

    // Reconnect exactly as a restart would: the previous session's data must be
    // there, and the hydration snapshot must be usable to restore it.
    let (log, snapshot) = DurableLog::open(&db).expect("reopen durable log");
    assert_eq!(snapshot.flows.len(), 1, "flow must survive the restart");
    assert_eq!(
        snapshot.sessions.len(),
        1,
        "session must survive the restart"
    );
    assert_eq!(snapshot.flows[0].id, 1);
    assert_eq!(snapshot.sessions[0].flow_ids, vec![1]);

    let mut restored = CaptureStore::new(PayloadPolicy::MetadataOnly);
    restored
        .apply_snapshot(snapshot)
        .expect("restored snapshot must satisfy referential integrity");
    assert_eq!(restored.flow_count(), 1);
    assert_eq!(restored.session_count(), 1);
    assert!(
        restored.flow(1).is_some(),
        "restored store must expose the flow"
    );
    log.shutdown();
}

#[test]
fn memory_only_store_reports_that_it_is_not_durable() {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    assert!(
        !store.is_durable(),
        "a default store has no durable backing"
    );
    assert!(
        store.durable_health().is_none(),
        "no durable backing must be reported as such, never faked"
    );

    store
        .insert_flow(flow(7, 42), vec![])
        .expect("in-memory writes cannot fail");
    assert_eq!(store.flow_count(), 1);
    assert!(store.flush_durable(Duration::from_secs(1)).is_ok());
}

#[test]
fn flush_fails_when_the_durable_writer_cannot_apply_a_write() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("capture.db");
    let (log, _snapshot) = DurableLog::open(&db).expect("open durable log");
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    store.attach_durable_log(log);

    // A session linked to a flow that was never written violates the database's
    // referential integrity, so the writer must fail — and flush must say so
    // instead of reporting a clean shutdown.
    store
        .insert_session(Session {
            id: 99,
            process_id: 0,
            start_ts: Timestamp::new(1, 1),
            trigger: "dangling".into(),
            flow_ids: vec![404],
        })
        .expect("enqueue succeeds; the failure is reported at flush time");

    let flush = store.flush_durable(Duration::from_secs(10));
    assert!(
        flush.is_err(),
        "flush must fail when a durable write was rejected"
    );

    let health = store.durable_health().expect("health");
    assert!(health.has_loss(), "loss must be reported: {health:?}");
    assert!(
        health.last_error.is_some(),
        "the failing write's error must be retained: {health:?}"
    );
    store.shutdown_durable();
}

#[test]
fn store_flush_trait_reports_durable_success() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("capture.db");
    let (log, _snapshot) = DurableLog::open(&db).expect("open durable log");
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    store.attach_durable_log(log);
    store.insert_flow(flow(2, 10), vec![]).expect("write");
    Store::flush(&mut store).expect("Store::flush must surface durable success");
    assert_eq!(
        store.durable_health().expect("health").applied,
        1,
        "the flow must have reached the database"
    );
    store.shutdown_durable();
}
