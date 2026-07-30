//! Tests for netpulse-storage SQLite migrations, schema validation, and repository persistence.

use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::{Confidence, Finding, FindingCategory, Flow, FlowMetrics, FlowState, HostName, NameSource, Session, Timestamp};
use netpulse_storage::{
    default_db_path, CaptureRepository, MigrationManager, SqliteCaptureRepository,
};
use std::net::{IpAddr, Ipv4Addr};

#[tokio::test]
async fn test_default_db_path_resolves() {
    let path = default_db_path();
    assert!(path.to_string_lossy().contains("capture.db"));
}

#[tokio::test]
async fn test_sqlite_connection_pragmas_and_migration() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("test_capture.db");

    let repo = SqliteCaptureRepository::connect(&db_path)
        .await
        .expect("connect sqlite");

    // Validate PRAGMAs and schema integrity
    MigrationManager::validate(repo.pool())
        .await
        .expect("schema validate");

    let status = MigrationManager::status(repo.pool())
        .await
        .expect("migration status");

    assert!(status.current_version.is_some());
    assert_eq!(status.current_version, Some(status.latest_version));
    assert!(status.pending.is_empty());
    assert!(!status.applied.is_empty());
}

#[tokio::test]
async fn test_sqlite_repository_data_roundtrip() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("roundtrip_capture.db");

    let repo = SqliteCaptureRepository::connect(&db_path)
        .await
        .expect("connect sqlite");

    let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let f = Flow {
        id: 101,
        key: FiveTuple::new(ip, 80, ip, 12345, L4Proto::Tcp),
        first_ts: Timestamp::new(1000, 1000),
        last_ts: Timestamp::new(2000, 2000),
        l4: L4Proto::Tcp,
        l7: L7Proto::Http1,
        stats: FlowMetrics::default(),
        state: FlowState::Closed,
    };

    repo.insert_flow(f.clone(), vec![])
        .await
        .expect("insert_flow");

    let s = Session {
        id: 202,
        process_id: 123,
        start_ts: Timestamp::new(1000, 1000),
        trigger: "test_trigger".into(),
        flow_ids: vec![101],
    };
    repo.insert_session(s.clone())
        .await
        .expect("insert_session");

    let finding = Finding {
        id: 303,
        category: FindingCategory::Suspicious,
        confidence: Confidence::new(0.85),
        evidence_refs: vec![],
    };
    repo.insert_finding(finding.clone())
        .await
        .expect("insert_finding");

    let names = vec![HostName {
        name: "example.com".into(),
        source: NameSource::Dns,
    }];
    repo.set_resolution(ip, names)
        .await
        .expect("set_resolution");

    let queried_session = repo
        .session(202)
        .await
        .expect("session query")
        .expect("found session");
    assert_eq!(queried_session.id, 202);
    assert_eq!(queried_session.trigger, "test_trigger");

    let queried_finding = repo
        .finding(303)
        .await
        .expect("finding query")
        .expect("found finding");
    assert_eq!(queried_finding.finding.id, 303);

    let names_back = repo
        .names_for(&ip)
        .await
        .expect("names_for");
    assert_eq!(names_back.len(), 1);
    assert_eq!(names_back[0].name, "example.com");

    let session_count = repo
        .session_count()
        .await
        .expect("session_count");
    assert_eq!(session_count, 1);
}

#[tokio::test]
async fn test_multi_migration_and_data_preservation() {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("preservation.db");

    // 1. Initial connect and insert
    let repo = SqliteCaptureRepository::connect(&db_path)
        .await
        .expect("connect initial");
    let s = Session {
        id: 777,
        process_id: 1,
        start_ts: Timestamp::new(500, 500),
        trigger: "preservation_test".into(),
        flow_ids: vec![],
    };
    repo.insert_session(s)
        .await
        .expect("insert_session");

    // 2. Re-connect, validate schema and ensure data preserved
    let repo2 = SqliteCaptureRepository::connect(&db_path)
        .await
        .expect("reconnect");
    MigrationManager::validate(repo2.pool())
        .await
        .expect("validate reconnect");

    let session_back = repo2
        .session(777)
        .await
        .expect("query session")
        .expect("session exists");
    assert_eq!(session_back.id, 777);
    assert_eq!(session_back.trigger, "preservation_test");
}
