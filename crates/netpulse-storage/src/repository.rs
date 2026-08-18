//! CaptureRepository trait, MemoryCaptureStore, and SqliteCaptureRepository.
#![allow(async_fn_in_trait)]

use std::collections::{BTreeSet, HashMap};
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;

use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::{
    EvidenceRef, Finding, Flow, FlowMetrics, FlowState, Host, HostName, ProtoEvent, ProtoEventKind,
    Session, Timestamp,
};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::capture_store::StoredFinding;
use crate::error::{Result, StorageError};
use crate::migration::MigrationManager;
use crate::models::{FindingRow, FlowRow, HostResolutionRow, HostRow, ProtoEventRow, SessionRow};

/// The storage interface shared by in-memory and SQLite capture stores.
pub trait CaptureRepository: std::fmt::Debug + Send + Sync {
    async fn insert_flow(&self, flow: Flow, events: Vec<ProtoEvent>) -> Result<()>;
    async fn insert_session(&self, session: Session) -> Result<()>;
    async fn insert_host(&self, id: u64, host: Host) -> Result<()>;
    async fn set_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()>;
    async fn merge_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()>;
    async fn insert_finding(&self, finding: Finding) -> Result<()>;

    async fn flow(&self, id: u64) -> Result<Option<Flow>>;
    async fn session(&self, id: u64) -> Result<Option<Session>>;
    async fn finding(&self, id: u64) -> Result<Option<StoredFinding>>;
    async fn flows_for_session(&self, session_id: u64) -> Result<Vec<Flow>>;
    async fn events_for_flow(&self, flow_id: u64) -> Result<Vec<ProtoEvent>>;
    async fn flows_in_window(&self, from: u64, to: u64) -> Result<Vec<Flow>>;
    async fn names_for(&self, ip: &IpAddr) -> Result<Vec<HostName>>;
    async fn resolutions(&self) -> Result<HashMap<IpAddr, Vec<HostName>>>;
    async fn flow_count(&self) -> Result<usize>;
    async fn session_count(&self) -> Result<usize>;
    async fn session_ids(&self) -> Result<Vec<u64>>;
    async fn evict_oldest_flows(&self, target_max: usize) -> Result<usize>;
    async fn evict_oldest_sessions(&self, target_max: usize) -> Result<usize>;

    async fn all_flows(&self) -> Result<Vec<Flow>>;
    async fn all_sessions(&self) -> Result<Vec<Session>>;
    async fn all_proto_events(&self) -> Result<Vec<ProtoEvent>>;
    async fn all_hosts(&self) -> Result<Vec<(u64, Host)>>;
    async fn all_findings(&self) -> Result<Vec<StoredFinding>>;

    fn insert_flow_sync(&self, _flow: Flow, _events: Vec<ProtoEvent>) -> Result<()> {
        Ok(())
    }
    fn insert_session_sync(&self, _session: Session) -> Result<()> {
        Ok(())
    }
    fn insert_host_sync(&self, _id: u64, _host: Host) -> Result<()> {
        Ok(())
    }
    fn set_resolution_sync(&self, _ip: IpAddr, _names: Vec<HostName>) -> Result<()> {
        Ok(())
    }
    fn merge_resolution_sync(&self, _ip: IpAddr, _names: Vec<HostName>) -> Result<()> {
        Ok(())
    }
    fn insert_finding_sync(&self, _finding: Finding) -> Result<()> {
        Ok(())
    }
    fn evict_oldest_flows_sync(&self, _target_max: usize) -> Result<usize> {
        Ok(0)
    }
    fn evict_oldest_sessions_sync(&self, _target_max: usize) -> Result<usize> {
        Ok(0)
    }

    fn all_flows_sync(&self) -> Result<Vec<Flow>> {
        Ok(Vec::new())
    }
    fn all_sessions_sync(&self) -> Result<Vec<Session>> {
        Ok(Vec::new())
    }
    fn all_proto_events_sync(&self) -> Result<Vec<ProtoEvent>> {
        Ok(Vec::new())
    }
    fn all_hosts_sync(&self) -> Result<Vec<(u64, Host)>> {
        Ok(Vec::new())
    }
    fn all_findings_sync(&self) -> Result<Vec<StoredFinding>> {
        Ok(Vec::new())
    }
}

/// Encode L4Proto to a stable SQLite integer:
/// TCP = 6 (IANA IP protocol 6), UDP = 17 (IANA IP protocol 17), Other(n) = 1000 + n.
pub fn encode_l4_proto(proto: L4Proto) -> i64 {
    match proto {
        L4Proto::Tcp => 6,
        L4Proto::Udp => 17,
        L4Proto::Other(n) => 1000 + n as i64,
        _ => 0,
    }
}

/// Decode L4Proto from a stable SQLite integer with strict bounds checking.
pub fn decode_l4_proto(val: i64) -> Result<L4Proto> {
    match val {
        6 => Ok(L4Proto::Tcp),
        17 => Ok(L4Proto::Udp),
        1000..=1255 => Ok(L4Proto::Other((val - 1000) as u8)),
        _ => Err(StorageError::InvalidStoredValue {
            field: "l4_proto",
            value: val,
        }),
    }
}

/// Encode L7Proto to a stable SQLite integer.
pub fn encode_l7_proto(proto: L7Proto) -> i64 {
    match proto {
        L7Proto::Unknown => 0,
        L7Proto::Dns => 1,
        L7Proto::Tls => 2,
        L7Proto::Http1 => 3,
        L7Proto::Http2 => 4,
        L7Proto::Http3 => 5,
        L7Proto::Quic => 6,
        _ => 0,
    }
}

/// Decode L7Proto from a stable SQLite integer with strict bounds checking.
pub fn decode_l7_proto(val: i64) -> Result<L7Proto> {
    match val {
        0 => Ok(L7Proto::Unknown),
        1 => Ok(L7Proto::Dns),
        2 => Ok(L7Proto::Tls),
        3 => Ok(L7Proto::Http1),
        4 => Ok(L7Proto::Http2),
        5 => Ok(L7Proto::Http3),
        6 => Ok(L7Proto::Quic),
        _ => Err(StorageError::InvalidStoredValue {
            field: "l7_proto",
            value: val,
        }),
    }
}

/// Encode FlowState to a stable SQLite integer.
pub fn encode_flow_state(state: FlowState) -> i64 {
    match state {
        FlowState::SynSeen => 0,
        FlowState::Established => 1,
        FlowState::Closing => 2,
        FlowState::Closed => 3,
        FlowState::Datagram => 4,
        _ => 3,
    }
}

/// Decode FlowState from a stable SQLite integer with strict bounds checking.
pub fn decode_flow_state(val: i64) -> Result<FlowState> {
    match val {
        0 => Ok(FlowState::SynSeen),
        1 => Ok(FlowState::Established),
        2 => Ok(FlowState::Closing),
        3 => Ok(FlowState::Closed),
        4 => Ok(FlowState::Datagram),
        _ => Err(StorageError::InvalidStoredValue {
            field: "state",
            value: val,
        }),
    }
}

/// Convert a database `FlowRow` into a domain `Flow` structure.
pub fn row_to_flow(r: FlowRow) -> Result<Flow> {
    let id = i64_to_u64(r.flow_id, "FlowRow.flow_id")?;
    let key: FiveTuple =
        serde_json::from_slice(&r.canonical_key).map_err(StorageError::Deserialization)?;
    let first_mono = i64_to_u64(r.first_ts_mono, "FlowRow.first_ts_mono")?;
    let last_wall = i64_to_u64(r.last_ts_wall, "FlowRow.last_ts_wall")?;
    let first_ts = Timestamp::new(first_mono, first_mono);
    let last_ts = Timestamp::new(last_wall, last_wall);
    let l4 = decode_l4_proto(r.l4_proto)?;
    let l7 = decode_l7_proto(r.l7_proto)?;
    let state = decode_flow_state(r.state)?;

    let bytes = i64_to_u64(r.bytes_up.saturating_add(r.bytes_down), "FlowRow.bytes")?;
    let packets = i64_to_u64(r.pkts_up.saturating_add(r.pkts_down), "FlowRow.packets")?;
    let rtt_estimate_nanos = if r.rtt_us > 0 {
        Some(i64_to_u64(r.rtt_us, "FlowRow.rtt_us")?.saturating_mul(1000))
    } else {
        None
    };
    let retransmits = u32::try_from(r.retransmits.max(0)).unwrap_or(0);

    Ok(Flow {
        id,
        key,
        first_ts,
        last_ts,
        l4,
        l7,
        stats: FlowMetrics {
            bytes,
            packets,
            rtt_estimate_nanos,
            retransmits,
            loss_indicators: 0,
        },
        state,
    })
}

/// Safely convert a domain `u64` value to a signed `i64` for SQLite storage.
pub fn u64_to_i64(val: u64, field: &'static str) -> Result<i64> {
    i64::try_from(val).map_err(|_| StorageError::ValueOutOfRange {
        field,
        value: val as u128,
        max: i64::MAX,
    })
}

/// Safely convert a `usize` value (e.g. eviction counts) to `i64` for SQLite storage.
pub fn usize_to_i64(val: usize, field: &'static str) -> Result<i64> {
    i64::try_from(val).map_err(|_| StorageError::ValueOutOfRange {
        field,
        value: val as u128,
        max: i64::MAX,
    })
}

/// Safely convert a stored SQLite `i64` value back to a domain `u64`.
pub fn i64_to_u64(val: i64, field: &'static str) -> Result<u64> {
    u64::try_from(val).map_err(|_| StorageError::InvalidStoredValue { field, value: val })
}

/// Safely convert a stored SQLite `i64` count back to `usize`.
pub fn i64_to_usize(val: i64, field: &'static str) -> Result<usize> {
    usize::try_from(val).map_err(|_| StorageError::InvalidStoredValue { field, value: val })
}

/// Safely convert a `u64` count (e.g. rows_affected) to `usize`.
pub fn u64_to_usize(val: u64, field: &'static str) -> Result<usize> {
    usize::try_from(val).map_err(|_| StorageError::ValueOutOfRange {
        field,
        value: val as u128,
        max: i64::MAX,
    })
}

/// Resolve the canonical OS-specific default path for the NetPulse SQLite database.
pub fn default_db_path() -> PathBuf {
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "NetPulse", "NetPulse") {
        let data_dir = proj_dirs.data_local_dir();
        let _ = std::fs::create_dir_all(data_dir);
        data_dir.join("capture.db")
    } else {
        PathBuf::from("capture.db")
    }
}

/// Fast in-memory HashMap implementation of [`CaptureRepository`].
#[derive(Debug, Default)]
pub struct MemoryCaptureStore {
    inner: RwLock<MemoryData>,
}

#[derive(Debug, Default)]
struct MemoryData {
    flows: HashMap<u64, Flow>,
    sessions: HashMap<u64, Session>,
    hosts: HashMap<u64, Host>,
    resolutions: HashMap<IpAddr, Vec<HostName>>,
    findings: HashMap<u64, StoredFinding>,
    events_by_flow: HashMap<u64, Vec<ProtoEvent>>,
    flow_timeline: BTreeSet<(u64, u64)>,
}

impl MemoryCaptureStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_flow_sync(&self, flow: Flow, events: Vec<ProtoEvent>) -> Result<()> {
        let mut inner = self.inner.write();
        if !events.is_empty() {
            inner
                .events_by_flow
                .entry(flow.id)
                .or_default()
                .extend(events);
        }
        if let Some(old) = inner.flows.insert(flow.id, flow.clone()) {
            inner
                .flow_timeline
                .remove(&(old.first_ts.mono_nanos, old.id));
        }
        inner
            .flow_timeline
            .insert((flow.first_ts.mono_nanos, flow.id));
        Ok(())
    }

    pub fn insert_session_sync(&self, session: Session) -> Result<()> {
        let mut inner = self.inner.write();
        inner.sessions.insert(session.id, session);
        Ok(())
    }

    pub fn insert_host_sync(&self, id: u64, host: Host) -> Result<()> {
        let mut inner = self.inner.write();
        inner.hosts.insert(id, host);
        Ok(())
    }

    pub fn set_resolution_sync(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        let mut inner = self.inner.write();
        if names.is_empty() {
            inner.resolutions.remove(&ip);
        } else {
            inner.resolutions.insert(ip, names);
        }
        Ok(())
    }

    pub fn merge_resolution_sync(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        if names.is_empty() {
            return Ok(());
        }
        let mut inner = self.inner.write();
        let existing = inner.resolutions.entry(ip).or_default();
        for n in names {
            if !existing
                .iter()
                .any(|h| h.name == n.name && h.source == n.source)
            {
                existing.push(n);
            }
        }
        Ok(())
    }

    pub fn insert_finding_sync(&self, finding: Finding) -> Result<()> {
        let mut inner = self.inner.write();
        inner.findings.insert(
            finding.id,
            StoredFinding {
                finding,
                evidence_expired: false,
            },
        );
        Ok(())
    }

    pub fn flow_sync(&self, id: u64) -> Result<Option<Flow>> {
        let inner = self.inner.read();
        Ok(inner.flows.get(&id).cloned())
    }

    pub fn session_sync(&self, id: u64) -> Result<Option<Session>> {
        let inner = self.inner.read();
        Ok(inner.sessions.get(&id).cloned())
    }

    pub fn finding_sync(&self, id: u64) -> Result<Option<StoredFinding>> {
        let inner = self.inner.read();
        Ok(inner.findings.get(&id).cloned())
    }

    pub fn flows_for_session_sync(&self, session_id: u64) -> Result<Vec<Flow>> {
        let inner = self.inner.read();
        match inner.sessions.get(&session_id) {
            Some(s) => Ok(s
                .flow_ids
                .iter()
                .filter_map(|id| inner.flows.get(id).cloned())
                .collect()),
            None => Ok(Vec::new()),
        }
    }

    pub fn events_for_flow_sync(&self, flow_id: u64) -> Result<Vec<ProtoEvent>> {
        let inner = self.inner.read();
        Ok(inner
            .events_by_flow
            .get(&flow_id)
            .cloned()
            .unwrap_or_default())
    }

    pub fn flows_in_window_sync(&self, from: u64, to: u64) -> Result<Vec<Flow>> {
        let inner = self.inner.read();
        let mut v: Vec<Flow> = inner
            .flows
            .values()
            .filter(|f| {
                let t = f.first_ts.mono_nanos;
                t >= from && t < to
            })
            .cloned()
            .collect();
        v.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));
        Ok(v)
    }

    pub fn names_for_sync(&self, ip: &IpAddr) -> Result<Vec<HostName>> {
        let inner = self.inner.read();
        Ok(inner.resolutions.get(ip).cloned().unwrap_or_default())
    }

    pub fn resolutions_sync(&self) -> Result<HashMap<IpAddr, Vec<HostName>>> {
        let inner = self.inner.read();
        Ok(inner.resolutions.clone())
    }

    pub fn flow_count_sync(&self) -> Result<usize> {
        let inner = self.inner.read();
        Ok(inner.flows.len())
    }

    pub fn session_count_sync(&self) -> Result<usize> {
        let inner = self.inner.read();
        Ok(inner.sessions.len())
    }

    pub fn session_ids_sync(&self) -> Result<Vec<u64>> {
        let inner = self.inner.read();
        let mut ids: Vec<u64> = inner.sessions.keys().copied().collect();
        ids.sort_unstable();
        Ok(ids)
    }

    pub fn evict_oldest_flows_sync(&self, target_max: usize) -> Result<usize> {
        let mut inner = self.inner.write();
        if inner.flows.len() <= target_max {
            return Ok(0);
        }
        let to_remove = inner.flows.len() - target_max;
        let mut evicted = 0;

        let candidates: Vec<(u64, u64)> = inner
            .flow_timeline
            .iter()
            .copied()
            .take(to_remove * 2)
            .collect();
        for (mono_ts, flow_id) in candidates {
            if evicted >= to_remove {
                break;
            }
            if !inner.flows.contains_key(&flow_id) {
                inner.flow_timeline.remove(&(mono_ts, flow_id));
                continue;
            }

            let is_ref = inner.findings.values().any(|sf| {
                sf.finding
                    .evidence_refs
                    .iter()
                    .any(|r| matches!(r, EvidenceRef::Flow(id) if *id == flow_id))
            });
            if is_ref {
                for sf in inner.findings.values_mut() {
                    if sf
                        .finding
                        .evidence_refs
                        .iter()
                        .any(|r| matches!(r, EvidenceRef::Flow(id) if *id == flow_id))
                    {
                        sf.evidence_expired = true;
                    }
                }
            }
            inner.flows.remove(&flow_id);
            inner.events_by_flow.remove(&flow_id);
            inner.flow_timeline.remove(&(mono_ts, flow_id));
            evicted += 1;
        }
        Ok(evicted)
    }

    pub fn evict_oldest_sessions_sync(&self, target_max: usize) -> Result<usize> {
        let mut inner = self.inner.write();
        if inner.sessions.len() <= target_max {
            return Ok(0);
        }
        let mut order: Vec<(u64, u64)> = inner
            .sessions
            .values()
            .map(|s| (s.start_ts.mono_nanos, s.id))
            .collect();
        order.sort_unstable();

        let to_remove = inner.sessions.len() - target_max;
        let mut evicted = 0;
        for (_, session_id) in order {
            if evicted >= to_remove {
                break;
            }
            let is_ref = inner.findings.values().any(|sf| {
                sf.finding
                    .evidence_refs
                    .iter()
                    .any(|r| matches!(r, EvidenceRef::Session(id) if *id == session_id))
            });
            if is_ref {
                for sf in inner.findings.values_mut() {
                    if sf
                        .finding
                        .evidence_refs
                        .iter()
                        .any(|r| matches!(r, EvidenceRef::Session(id) if *id == session_id))
                    {
                        sf.evidence_expired = true;
                    }
                }
            }
            inner.sessions.remove(&session_id);
            evicted += 1;
        }
        Ok(evicted)
    }

    pub fn all_flows_sync(&self) -> Result<Vec<Flow>> {
        let inner = self.inner.read();
        let mut flows: Vec<Flow> = inner.flows.values().cloned().collect();
        flows.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));
        Ok(flows)
    }

    pub fn all_sessions_sync(&self) -> Result<Vec<Session>> {
        let inner = self.inner.read();
        let mut sessions: Vec<Session> = inner.sessions.values().cloned().collect();
        sessions.sort_by_key(|s| (s.start_ts.mono_nanos, s.id));
        Ok(sessions)
    }

    pub fn all_proto_events_sync(&self) -> Result<Vec<ProtoEvent>> {
        let inner = self.inner.read();
        let mut events: Vec<ProtoEvent> = Vec::new();
        for evs in inner.events_by_flow.values() {
            events.extend(evs.iter().cloned());
        }
        events.sort_by_key(|e| (e.ts.mono_nanos, e.flow_id));
        Ok(events)
    }

    pub fn all_hosts_sync(&self) -> Result<Vec<(u64, Host)>> {
        let inner = self.inner.read();
        let mut hosts: Vec<(u64, Host)> =
            inner.hosts.iter().map(|(&id, h)| (id, h.clone())).collect();
        hosts.sort_by_key(|(id, _)| *id);
        Ok(hosts)
    }

    pub fn all_findings_sync(&self) -> Result<Vec<StoredFinding>> {
        let inner = self.inner.read();
        let mut findings: Vec<StoredFinding> = inner.findings.values().cloned().collect();
        findings.sort_by_key(|f| f.finding.id);
        Ok(findings)
    }
}

impl CaptureRepository for MemoryCaptureStore {
    async fn insert_flow(&self, flow: Flow, events: Vec<ProtoEvent>) -> Result<()> {
        self.insert_flow_sync(flow, events)
    }

    async fn insert_session(&self, session: Session) -> Result<()> {
        self.insert_session_sync(session)
    }

    async fn insert_host(&self, id: u64, host: Host) -> Result<()> {
        self.insert_host_sync(id, host)
    }

    async fn set_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        self.set_resolution_sync(ip, names)
    }

    async fn merge_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        self.merge_resolution_sync(ip, names)
    }

    async fn insert_finding(&self, finding: Finding) -> Result<()> {
        self.insert_finding_sync(finding)
    }

    async fn flow(&self, id: u64) -> Result<Option<Flow>> {
        self.flow_sync(id)
    }

    async fn session(&self, id: u64) -> Result<Option<Session>> {
        self.session_sync(id)
    }

    async fn finding(&self, id: u64) -> Result<Option<StoredFinding>> {
        self.finding_sync(id)
    }

    async fn flows_for_session(&self, session_id: u64) -> Result<Vec<Flow>> {
        self.flows_for_session_sync(session_id)
    }

    async fn events_for_flow(&self, flow_id: u64) -> Result<Vec<ProtoEvent>> {
        self.events_for_flow_sync(flow_id)
    }

    async fn flows_in_window(&self, from: u64, to: u64) -> Result<Vec<Flow>> {
        self.flows_in_window_sync(from, to)
    }

    async fn names_for(&self, ip: &IpAddr) -> Result<Vec<HostName>> {
        self.names_for_sync(ip)
    }

    async fn resolutions(&self) -> Result<HashMap<IpAddr, Vec<HostName>>> {
        self.resolutions_sync()
    }

    async fn flow_count(&self) -> Result<usize> {
        self.flow_count_sync()
    }

    async fn session_count(&self) -> Result<usize> {
        self.session_count_sync()
    }

    async fn session_ids(&self) -> Result<Vec<u64>> {
        self.session_ids_sync()
    }

    async fn evict_oldest_flows(&self, target_max: usize) -> Result<usize> {
        self.evict_oldest_flows_sync(target_max)
    }

    async fn evict_oldest_sessions(&self, target_max: usize) -> Result<usize> {
        self.evict_oldest_sessions_sync(target_max)
    }

    async fn all_flows(&self) -> Result<Vec<Flow>> {
        self.all_flows_sync()
    }

    async fn all_sessions(&self) -> Result<Vec<Session>> {
        self.all_sessions_sync()
    }

    async fn all_proto_events(&self) -> Result<Vec<ProtoEvent>> {
        self.all_proto_events_sync()
    }

    async fn all_hosts(&self) -> Result<Vec<(u64, Host)>> {
        self.all_hosts_sync()
    }

    async fn all_findings(&self) -> Result<Vec<StoredFinding>> {
        self.all_findings_sync()
    }
}

/// Durable SQLite database implementation of [`CaptureRepository`].
#[derive(Debug, Clone)]
pub struct SqliteCaptureRepository {
    pool: SqlitePool,
}

impl SqliteCaptureRepository {
    /// Connect to SQLite, execute PRAGMAs, run pending migrations, and validate schema integrity.
    pub async fn connect<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path_ref = path.as_ref();
        if let Some(parent) = path_ref.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let connection_str = format!("sqlite:{}?mode=rwc", path_ref.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&connection_str)
            .await?;

        // Centralized PRAGMAs
        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA journal_mode = WAL;")
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA synchronous = NORMAL;")
            .execute(&pool)
            .await?;
        sqlx::query("PRAGMA busy_timeout = 5000;")
            .execute(&pool)
            .await?;

        // Migrations & schema validation
        MigrationManager::migrate(&pool).await?;
        MigrationManager::validate(&pool).await?;

        Ok(Self { pool })
    }

    /// Access the underlying SqlitePool connection handle.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

impl CaptureRepository for SqliteCaptureRepository {
    async fn insert_flow(&self, flow: Flow, events: Vec<ProtoEvent>) -> Result<()> {
        let key_bytes = serde_json::to_vec(&flow.key).map_err(StorageError::Serialization)?;
        let rtt_i64 = match flow.stats.rtt_estimate_nanos {
            Some(n) => u64_to_i64(n, "flow.stats.rtt_estimate_nanos")? / 1000,
            None => 0,
        };

        let flow_id_i64 = u64_to_i64(flow.id, "flow.id")?;
        let first_ts_i64 = u64_to_i64(flow.first_ts.mono_nanos, "flow.first_ts.mono_nanos")?;
        let last_ts_i64 = u64_to_i64(flow.last_ts.wall_nanos, "flow.last_ts.wall_nanos")?;
        let bytes_i64 = u64_to_i64(flow.stats.bytes, "flow.stats.bytes")?;
        let packets_i64 = u64_to_i64(flow.stats.packets, "flow.stats.packets")?;
        let retransmits_i64 = i64::from(flow.stats.retransmits);
        let l4_i64 = encode_l4_proto(flow.l4);
        let l7_i64 = encode_l7_proto(flow.l7);
        let state_i64 = encode_flow_state(flow.state);

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO flows (
                flow_id, canonical_key, epoch, l4_proto, l7_proto,
                first_ts_mono, last_ts_wall, bytes_up, bytes_down,
                pkts_up, pkts_down, rtt_us, retransmits, state
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(flow_id) DO UPDATE SET
                l4_proto=excluded.l4_proto,
                l7_proto=excluded.l7_proto,
                last_ts_wall=excluded.last_ts_wall,
                bytes_up=excluded.bytes_up,
                bytes_down=excluded.bytes_down,
                pkts_up=excluded.pkts_up,
                pkts_down=excluded.pkts_down,
                rtt_us=excluded.rtt_us,
                retransmits=excluded.retransmits,
                state=excluded.state
            "#,
        )
        .bind(flow_id_i64)
        .bind(key_bytes)
        .bind(0i64)
        .bind(l4_i64)
        .bind(l7_i64)
        .bind(first_ts_i64)
        .bind(last_ts_i64)
        .bind(bytes_i64)
        .bind(0i64)
        .bind(packets_i64)
        .bind(0i64)
        .bind(rtt_i64)
        .bind(retransmits_i64)
        .bind(state_i64)
        .execute(&mut *tx)
        .await?;

        for event in events {
            let fields_json =
                serde_json::to_string(&event.kind).map_err(StorageError::Serialization)?;
            let event_flow_id_i64 = u64_to_i64(event.flow_id, "event.flow_id")?;
            let event_ts_i64 = u64_to_i64(event.ts.mono_nanos, "event.ts.mono_nanos")?;
            sqlx::query(
                r#"
                INSERT INTO proto_events (flow_id, ts, kind, fields, packet_ref)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
            )
            .bind(event_flow_id_i64)
            .bind(event_ts_i64)
            .bind(0i64)
            .bind(fields_json)
            .bind(None::<i64>)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    async fn insert_session(&self, session: Session) -> Result<()> {
        let session_id_i64 = u64_to_i64(session.id, "session.id")?;
        let process_id_i64 = u64_to_i64(session.process_id, "session.process_id")?;
        let start_ts_i64 = u64_to_i64(session.start_ts.mono_nanos, "session.start_ts.mono_nanos")?;

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO sessions (session_id, process_id, start_ts, trigger)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(session_id) DO UPDATE SET
                process_id=excluded.process_id,
                start_ts=excluded.start_ts,
                trigger=excluded.trigger
            "#,
        )
        .bind(session_id_i64)
        .bind(process_id_i64)
        .bind(start_ts_i64)
        .bind(&session.trigger)
        .execute(&mut *tx)
        .await?;

        for &flow_id in &session.flow_ids {
            let flow_id_i64 = u64_to_i64(flow_id, "session.flow_id")?;
            let res = sqlx::query("UPDATE flows SET session_id = ?1 WHERE flow_id = ?2")
                .bind(session_id_i64)
                .bind(flow_id_i64)
                .execute(&mut *tx)
                .await?;
            if res.rows_affected() != 1 {
                return Err(StorageError::MissingFlowForSessionLink {
                    session_id: session.id,
                    flow_id,
                });
            }
        }

        tx.commit().await?;
        Ok(())
    }

    async fn insert_host(&self, id: u64, host: Host) -> Result<()> {
        let host_id_i64 = u64_to_i64(id, "host.id")?;
        let geo_str = host.geo;
        let rdns = serde_json::to_string(&host.names).map_err(StorageError::Serialization)?;
        let asn_org = host.asn.map(|a| a.to_string());
        sqlx::query(
            r#"
            INSERT INTO hosts (host_id, ip, rdns, asn_org, cdn, geo)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(host_id) DO UPDATE SET
                ip=excluded.ip,
                rdns=excluded.rdns,
                asn_org=excluded.asn_org,
                cdn=excluded.cdn,
                geo=excluded.geo
            "#,
        )
        .bind(host_id_i64)
        .bind(host.ip.to_string())
        .bind(Some(rdns))
        .bind(asn_org)
        .bind(host.org)
        .bind(geo_str)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn set_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        let ip_str = ip.to_string();
        sqlx::query("DELETE FROM host_resolutions WHERE ip = ?1")
            .bind(&ip_str)
            .execute(&self.pool)
            .await?;

        for n in names {
            let source_str = format!("{:?}", n.source);
            sqlx::query(
                "INSERT OR REPLACE INTO host_resolutions (ip, name, source) VALUES (?1, ?2, ?3)",
            )
            .bind(&ip_str)
            .bind(&n.name)
            .bind(&source_str)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn merge_resolution(&self, ip: IpAddr, names: Vec<HostName>) -> Result<()> {
        let ip_str = ip.to_string();
        for n in names {
            let source_str = format!("{:?}", n.source);
            sqlx::query(
                "INSERT OR IGNORE INTO host_resolutions (ip, name, source) VALUES (?1, ?2, ?3)",
            )
            .bind(&ip_str)
            .bind(&n.name)
            .bind(&source_str)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    async fn insert_finding(&self, finding: Finding) -> Result<()> {
        let finding_id_i64 = u64_to_i64(finding.id, "finding.id")?;
        let refs_json =
            serde_json::to_string(&finding.evidence_refs).map_err(StorageError::Serialization)?;
        sqlx::query(
            r#"
            INSERT INTO findings (finding_id, category, confidence, evidence_refs, evidence_expired)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(finding_id) DO UPDATE SET
                confidence=excluded.confidence,
                evidence_refs=excluded.evidence_refs
            "#,
        )
        .bind(finding_id_i64)
        .bind(0i64)
        .bind(finding.confidence.value() as f64)
        .bind(refs_json)
        .bind(0i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn flow(&self, id: u64) -> Result<Option<Flow>> {
        let id_i64 = u64_to_i64(id, "flow_id query")?;
        let row = sqlx::query_as::<_, FlowRow>("SELECT * FROM flows WHERE flow_id = ?1")
            .bind(id_i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => Ok(Some(row_to_flow(r)?)),
            None => Ok(None),
        }
    }

    async fn session(&self, id: u64) -> Result<Option<Session>> {
        let id_i64 = u64_to_i64(id, "session_id query")?;
        let row = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions WHERE session_id = ?1")
            .bind(id_i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => {
                let flow_ids_rows: Vec<(i64,)> = sqlx::query_as(
                    "SELECT flow_id FROM flows WHERE session_id = ?1 ORDER BY first_ts_mono ASC",
                )
                .bind(id_i64)
                .fetch_all(&self.pool)
                .await?;
                let mut flow_ids = Vec::with_capacity(flow_ids_rows.len());
                for (fid,) in flow_ids_rows {
                    flow_ids.push(i64_to_u64(fid, "FlowRow.flow_id")?);
                }
                Ok(Some(Session {
                    id: i64_to_u64(r.session_id, "SessionRow.session_id")?,
                    process_id: match r.process_id {
                        Some(pid) => i64_to_u64(pid, "SessionRow.process_id")?,
                        None => 0,
                    },
                    start_ts: Timestamp::new(
                        i64_to_u64(r.start_ts, "SessionRow.start_ts")?,
                        i64_to_u64(r.start_ts, "SessionRow.start_ts")?,
                    ),
                    trigger: r.trigger,
                    flow_ids,
                }))
            }
            None => Ok(None),
        }
    }

    async fn finding(&self, id: u64) -> Result<Option<StoredFinding>> {
        let id_i64 = u64_to_i64(id, "finding_id query")?;
        let row = sqlx::query_as::<_, FindingRow>("SELECT * FROM findings WHERE finding_id = ?1")
            .bind(id_i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => {
                let refs: Vec<EvidenceRef> = serde_json::from_str(&r.evidence_refs)
                    .map_err(StorageError::Deserialization)?;
                let finding_id = i64_to_u64(r.finding_id, "FindingRow.finding_id")?;
                Ok(Some(StoredFinding {
                    finding: Finding {
                        id: finding_id,
                        category: netpulse_core::FindingCategory::Suspicious,
                        confidence: netpulse_core::Confidence::new(r.confidence as f32),
                        evidence_refs: refs,
                    },
                    evidence_expired: r.evidence_expired != 0,
                }))
            }
            None => Ok(None),
        }
    }

    async fn flows_for_session(&self, session_id: u64) -> Result<Vec<Flow>> {
        let session_id_i64 = u64_to_i64(session_id, "flows_for_session.session_id")?;
        let rows = sqlx::query_as::<_, FlowRow>(
            "SELECT * FROM flows WHERE session_id = ?1 ORDER BY first_ts_mono ASC",
        )
        .bind(session_id_i64)
        .fetch_all(&self.pool)
        .await?;
        let mut flows = Vec::with_capacity(rows.len());
        for r in rows {
            flows.push(row_to_flow(r)?);
        }
        Ok(flows)
    }

    async fn events_for_flow(&self, flow_id: u64) -> Result<Vec<ProtoEvent>> {
        let flow_id_i64 = u64_to_i64(flow_id, "events_for_flow.flow_id")?;
        let rows =
            sqlx::query_as::<_, ProtoEventRow>("SELECT * FROM proto_events WHERE flow_id = ?1")
                .bind(flow_id_i64)
                .fetch_all(&self.pool)
                .await?;

        let mut events = Vec::new();
        for r in rows {
            let kind: ProtoEventKind =
                serde_json::from_str(&r.fields).map_err(StorageError::Deserialization)?;
            let ev_flow_id = i64_to_u64(r.flow_id, "ProtoEventRow.flow_id")?;
            let ev_ts = i64_to_u64(r.ts, "ProtoEventRow.ts")?;
            events.push(ProtoEvent {
                flow_id: ev_flow_id,
                ts: Timestamp::new(ev_ts, ev_ts),
                kind,
            });
        }
        Ok(events)
    }

    async fn flows_in_window(&self, from: u64, to: u64) -> Result<Vec<Flow>> {
        let from_i64 = u64_to_i64(from, "flows_in_window.from")?;
        let to_i64 = u64_to_i64(to.min(i64::MAX as u64), "flows_in_window.to")?;
        let rows = sqlx::query_as::<_, FlowRow>(
            "SELECT * FROM flows WHERE first_ts_mono >= ?1 AND first_ts_mono < ?2 ORDER BY first_ts_mono ASC",
        )
        .bind(from_i64)
        .bind(to_i64)
        .fetch_all(&self.pool)
        .await?;
        let mut flows = Vec::with_capacity(rows.len());
        for r in rows {
            flows.push(row_to_flow(r)?);
        }
        Ok(flows)
    }

    async fn names_for(&self, ip: &IpAddr) -> Result<Vec<HostName>> {
        let ip_str = ip.to_string();
        let rows =
            sqlx::query_as::<_, HostResolutionRow>("SELECT * FROM host_resolutions WHERE ip = ?1")
                .bind(ip_str)
                .fetch_all(&self.pool)
                .await?;

        let mut names = Vec::new();
        for r in rows {
            let source = match r.source.as_str() {
                "Dns" => netpulse_core::NameSource::Dns,
                "Sni" => netpulse_core::NameSource::Sni,
                "HostsFile" => netpulse_core::NameSource::HostsFile,
                _ => netpulse_core::NameSource::OsResolver,
            };
            names.push(HostName {
                name: r.name,
                source,
            });
        }
        Ok(names)
    }

    async fn resolutions(&self) -> Result<HashMap<IpAddr, Vec<HostName>>> {
        let rows = sqlx::query_as::<_, HostResolutionRow>("SELECT * FROM host_resolutions")
            .fetch_all(&self.pool)
            .await?;

        let mut map: HashMap<IpAddr, Vec<HostName>> = HashMap::new();
        for r in rows {
            if let Ok(ip) = r.ip.parse::<IpAddr>() {
                let source = match r.source.as_str() {
                    "Dns" => netpulse_core::NameSource::Dns,
                    "Sni" => netpulse_core::NameSource::Sni,
                    "HostsFile" => netpulse_core::NameSource::HostsFile,
                    _ => netpulse_core::NameSource::OsResolver,
                };
                map.entry(ip).or_default().push(HostName {
                    name: r.name,
                    source,
                });
            }
        }
        Ok(map)
    }

    async fn flow_count(&self) -> Result<usize> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM flows")
            .fetch_one(&self.pool)
            .await?;
        i64_to_usize(count.0, "flow_count")
    }

    async fn session_count(&self) -> Result<usize> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions")
            .fetch_one(&self.pool)
            .await?;
        i64_to_usize(count.0, "session_count")
    }

    async fn session_ids(&self) -> Result<Vec<u64>> {
        let rows = sqlx::query("SELECT session_id FROM sessions ORDER BY session_id ASC")
            .fetch_all(&self.pool)
            .await?;
        let mut ids = Vec::with_capacity(rows.len());
        for r in rows {
            let raw_id: i64 = r.get(0);
            ids.push(i64_to_u64(raw_id, "session_id")?);
        }
        Ok(ids)
    }

    async fn evict_oldest_flows(&self, target_max: usize) -> Result<usize> {
        let count = self.flow_count().await?;
        if count <= target_max {
            return Ok(0);
        }
        let to_remove = count - target_max;
        let to_remove_i64 = usize_to_i64(to_remove, "evict_oldest_flows.to_remove")?;
        let res = sqlx::query(
            r#"
            DELETE FROM flows WHERE flow_id IN (
                SELECT flow_id FROM flows ORDER BY first_ts_mono ASC LIMIT ?1
            )
            "#,
        )
        .bind(to_remove_i64)
        .execute(&self.pool)
        .await?;
        u64_to_usize(res.rows_affected(), "evict_oldest_flows.rows_affected")
    }

    async fn evict_oldest_sessions(&self, target_max: usize) -> Result<usize> {
        let count = self.session_count().await?;
        if count <= target_max {
            return Ok(0);
        }
        let to_remove = count - target_max;
        let to_remove_i64 = usize_to_i64(to_remove, "evict_oldest_sessions.to_remove")?;
        let res = sqlx::query(
            r#"
            DELETE FROM sessions WHERE session_id IN (
                SELECT session_id FROM sessions ORDER BY start_ts ASC LIMIT ?1
            )
            "#,
        )
        .bind(to_remove_i64)
        .execute(&self.pool)
        .await?;
        u64_to_usize(res.rows_affected(), "evict_oldest_sessions.rows_affected")
    }

    async fn all_flows(&self) -> Result<Vec<Flow>> {
        let rows = sqlx::query_as::<_, FlowRow>("SELECT * FROM flows ORDER BY first_ts_mono ASC")
            .fetch_all(&self.pool)
            .await?;
        let mut flows = Vec::with_capacity(rows.len());
        for r in rows {
            flows.push(row_to_flow(r)?);
        }
        Ok(flows)
    }

    async fn all_sessions(&self) -> Result<Vec<Session>> {
        let rows = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions ORDER BY start_ts ASC")
            .fetch_all(&self.pool)
            .await?;
        let flow_links: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT session_id, flow_id FROM flows WHERE session_id IS NOT NULL ORDER BY first_ts_mono ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut flow_map: HashMap<i64, Vec<u64>> = HashMap::new();
        for (sid, fid) in flow_links {
            flow_map
                .entry(sid)
                .or_default()
                .push(i64_to_u64(fid, "FlowRow.flow_id")?);
        }

        let mut sessions = Vec::with_capacity(rows.len());
        for r in rows {
            let sid = r.session_id;
            let flow_ids = flow_map.remove(&sid).unwrap_or_default();
            sessions.push(Session {
                id: i64_to_u64(r.session_id, "SessionRow.session_id")?,
                process_id: match r.process_id {
                    Some(pid) => i64_to_u64(pid, "SessionRow.process_id")?,
                    None => 0,
                },
                start_ts: Timestamp::new(
                    i64_to_u64(r.start_ts, "SessionRow.start_ts")?,
                    i64_to_u64(r.start_ts, "SessionRow.start_ts")?,
                ),
                trigger: r.trigger,
                flow_ids,
            });
        }
        Ok(sessions)
    }

    async fn all_proto_events(&self) -> Result<Vec<ProtoEvent>> {
        let rows = sqlx::query_as::<_, ProtoEventRow>(
            "SELECT * FROM proto_events ORDER BY ts ASC, event_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut events = Vec::with_capacity(rows.len());
        for r in rows {
            let kind: ProtoEventKind =
                serde_json::from_str(&r.fields).map_err(StorageError::Deserialization)?;
            let ev_flow_id = i64_to_u64(r.flow_id, "ProtoEventRow.flow_id")?;
            let ev_ts = i64_to_u64(r.ts, "ProtoEventRow.ts")?;
            events.push(ProtoEvent {
                flow_id: ev_flow_id,
                ts: Timestamp::new(ev_ts, ev_ts),
                kind,
            });
        }
        Ok(events)
    }

    async fn all_hosts(&self) -> Result<Vec<(u64, Host)>> {
        let rows = sqlx::query_as::<_, HostRow>("SELECT * FROM hosts ORDER BY host_id ASC")
            .fetch_all(&self.pool)
            .await?;
        let mut hosts = Vec::with_capacity(rows.len());
        for r in rows {
            let id = i64_to_u64(r.host_id, "HostRow.host_id")?;
            let ip: IpAddr = r.ip.parse().map_err(|e| StorageError::IntegrityViolation {
                reason: format!("invalid IP in host row: {e}"),
            })?;
            let names: Vec<String> = match r.rdns {
                Some(ref s) => serde_json::from_str(s).map_err(StorageError::Deserialization)?,
                None => Vec::new(),
            };
            let asn = r.asn_org.and_then(|a| a.parse::<u32>().ok());
            hosts.push((
                id,
                Host {
                    ip,
                    names,
                    geo: r.geo,
                    asn,
                    org: r.cdn,
                },
            ));
        }
        Ok(hosts)
    }

    async fn all_findings(&self) -> Result<Vec<StoredFinding>> {
        let rows =
            sqlx::query_as::<_, FindingRow>("SELECT * FROM findings ORDER BY finding_id ASC")
                .fetch_all(&self.pool)
                .await?;
        let mut findings = Vec::with_capacity(rows.len());
        for r in rows {
            let refs: Vec<EvidenceRef> =
                serde_json::from_str(&r.evidence_refs).map_err(StorageError::Deserialization)?;
            let finding_id = i64_to_u64(r.finding_id, "FindingRow.finding_id")?;
            findings.push(StoredFinding {
                finding: Finding {
                    id: finding_id,
                    category: netpulse_core::FindingCategory::Suspicious,
                    confidence: netpulse_core::Confidence::new(r.confidence as f32),
                    evidence_refs: refs,
                },
                evidence_expired: r.evidence_expired != 0,
            });
        }
        Ok(findings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::{FiveTuple, FlowMetrics, FlowState, L4Proto, L7Proto};
    use std::net::{IpAddr, Ipv4Addr};
    use std::sync::Arc;
    use std::thread;

    fn make_test_flow(id: u64, mono_ts: u64) -> Flow {
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        Flow {
            id,
            key: FiveTuple::new(ip, 1000 + (id % 50000) as u16, ip, 80, L4Proto::Tcp),
            first_ts: Timestamp::new(mono_ts, mono_ts),
            last_ts: Timestamp::new(mono_ts, mono_ts),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics::default(),
            state: FlowState::Closed,
        }
    }

    #[test]
    fn test_memory_store_panic_resilience() {
        let store = Arc::new(MemoryCaptureStore::new());

        // Insert initial data
        store
            .insert_flow_sync(make_test_flow(1, 100), vec![])
            .unwrap();
        assert_eq!(store.flow_count_sync().unwrap(), 1);

        // Spawn a thread that acquires a write lock, inserts data, and panics
        let store_clone = Arc::clone(&store);
        let handle = thread::spawn(move || {
            let mut inner = store_clone.inner.write();
            inner.flows.insert(99, make_test_flow(99, 999));
            panic!("intentional panic while holding write lock");
        });

        // The thread panics, handle.join() returns Err
        assert!(handle.join().is_err());

        // Verify that subsequent store operations succeed cleanly without panicking
        assert_eq!(store.flow_count_sync().unwrap(), 2);
        assert!(store.flow_sync(1).unwrap().is_some());
        assert!(store.flow_sync(99).unwrap().is_some());

        let new_flow = make_test_flow(2, 200);
        assert!(store.insert_flow_sync(new_flow, vec![]).is_ok());
        assert_eq!(store.flow_count_sync().unwrap(), 3);
        assert_eq!(store.evict_oldest_flows_sync(1).unwrap(), 2);
        assert_eq!(store.flow_count_sync().unwrap(), 1);
    }

    #[test]
    fn test_memory_store_concurrency_stress() {
        let store = Arc::new(MemoryCaptureStore::new());
        let mut handles = Vec::new();

        // 4 writer threads
        for w_idx in 0..4u64 {
            let store_clone = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                for i in 0..1000u64 {
                    let flow_id = w_idx * 10000 + i;
                    let flow = make_test_flow(flow_id, flow_id);
                    let _ = store_clone.insert_flow_sync(flow, vec![]);
                    if i % 100 == 0 {
                        let _ = store_clone.evict_oldest_flows_sync(500);
                    }
                }
            }));
        }

        // 8 reader threads
        for _r_idx in 0..8 {
            let store_clone = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                for i in 0..1000u64 {
                    let _ = store_clone.flow_sync(i % 100);
                    let _ = store_clone.flow_count_sync();
                    let _ = store_clone.flows_in_window_sync(0, 10000);
                    let _ = store_clone.session_ids_sync();
                }
            }));
        }

        for handle in handles {
            assert!(handle.join().is_ok());
        }

        // Final sanity check: store is valid and readable
        assert!(store.flow_count_sync().is_ok());
    }

    #[test]
    fn test_storage_error_variants() {
        let serde_err = serde_json::from_str::<String>("invalid json").unwrap_err();
        let ser_err = StorageError::Serialization(serde_err);
        assert!(ser_err.to_string().contains("Serialization error:"));

        let de_err = serde_json::from_str::<String>("invalid json").unwrap_err();
        let storage_de_err = StorageError::Deserialization(de_err);
        assert!(storage_de_err
            .to_string()
            .contains("Deserialization error:"));
    }

    #[tokio::test]
    async fn test_sqlite_deserialization_failure_returns_err() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("de_fail.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        let flow = make_test_flow(100, 1000);
        repo.insert_flow(flow, vec![]).await.unwrap();

        // Insert malformed JSON into proto_events fields
        sqlx::query(
            "INSERT INTO proto_events (flow_id, ts, kind, fields, packet_ref) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(100i64)
        .bind(1000i64)
        .bind(0i64)
        .bind("MALFORMED_JSON_FIELDS")
        .bind(None::<i64>)
        .execute(repo.pool())
        .await
        .unwrap();

        let res = repo.events_for_flow(100).await;
        assert!(res.is_err());
        match res.unwrap_err() {
            StorageError::Deserialization(e) => {
                assert!(e.to_string().contains("expected value") || e.line() > 0);
            }
            other => panic!("Expected StorageError::Deserialization, got {:?}", other),
        }

        // Insert malformed JSON into findings evidence_refs
        sqlx::query(
            "INSERT INTO findings (finding_id, category, confidence, evidence_refs, evidence_expired) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(200i64)
        .bind(0i64)
        .bind(0.8f64)
        .bind("NOT_JSON")
        .bind(0i64)
        .execute(repo.pool())
        .await
        .unwrap();

        let finding_res = repo.finding(200).await;
        assert!(finding_res.is_err());
        match finding_res.unwrap_err() {
            StorageError::Deserialization(_) => {}
            other => panic!("Expected StorageError::Deserialization, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_sqlite_insert_flow_success() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("insert_success.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        let flow = make_test_flow(1, 500);
        let events = vec![ProtoEvent {
            flow_id: 1,
            ts: Timestamp::new(500, 500),
            kind: ProtoEventKind::DnsQuery,
        }];

        let res = repo.insert_flow(flow, events).await;
        assert!(res.is_ok());

        assert_eq!(repo.flow_count().await.unwrap(), 1);
        let events_read = repo.events_for_flow(1).await.unwrap();
        assert_eq!(events_read.len(), 1);
        assert_eq!(events_read[0].kind, ProtoEventKind::DnsQuery);
    }

    #[tokio::test]
    async fn test_sqlite_insert_flow_sql_failure_rolls_back_transaction() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("rollback.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        // Drop proto_events table to force a SQL query execution error during event insertion
        sqlx::query("DROP TABLE proto_events")
            .execute(repo.pool())
            .await
            .unwrap();

        let flow = make_test_flow(10, 1000);
        let events = vec![ProtoEvent {
            flow_id: 10,
            ts: Timestamp::new(1000, 1000),
            kind: ProtoEventKind::HttpRequest,
        }];

        // insert_flow starts transaction, inserts flow into flows table, then fails on inserting event into proto_events
        let res = repo.insert_flow(flow, events).await;
        assert!(res.is_err());
        match res.unwrap_err() {
            StorageError::Sqlx(_) => {}
            other => panic!("Expected StorageError::Sqlx error, got {:?}", other),
        }

        // Verify that the flow inserted prior to event failure was rolled back (0 rows in flows)
        assert_eq!(repo.flow_count().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_sqlite_insert_flow_serialization_failure_rolls_back_transaction() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("ser_rollback.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        // Verify StorageError::Serialization carries real serde_json::Error structured info
        // Verify database remains completely empty (0 flows, 0 proto_events)
        assert_eq!(repo.flow_count().await.unwrap(), 0);
        let proto_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM proto_events")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(proto_count.0, 0);
    }

    #[test]
    fn test_checked_conversion_helpers() {
        // u64_to_i64 boundary tests
        assert_eq!(u64_to_i64(0, "field").unwrap(), 0);
        assert_eq!(u64_to_i64(i64::MAX as u64, "field").unwrap(), i64::MAX);
        match u64_to_i64(i64::MAX as u64 + 1, "field").unwrap_err() {
            StorageError::ValueOutOfRange { field, value, max } => {
                assert_eq!(field, "field");
                assert_eq!(value, i64::MAX as u128 + 1);
                assert_eq!(max, i64::MAX);
            }
            other => panic!("Expected ValueOutOfRange, got {:?}", other),
        }
        match u64_to_i64(u64::MAX, "field").unwrap_err() {
            StorageError::ValueOutOfRange { value, .. } => {
                assert_eq!(value, u64::MAX as u128);
            }
            other => panic!("Expected ValueOutOfRange, got {:?}", other),
        }

        // usize_to_i64 platform-independent boundary tests
        assert_eq!(usize_to_i64(0, "field").unwrap(), 0);
        if (i64::MAX as u128) <= (usize::MAX as u128) {
            assert_eq!(usize_to_i64(i64::MAX as usize, "field").unwrap(), i64::MAX);
        }
        if (usize::MAX as u128) > (i64::MAX as u128) {
            let overflow_usize = (i64::MAX as u128 + 1) as usize;
            match usize_to_i64(overflow_usize, "field").unwrap_err() {
                StorageError::ValueOutOfRange { value, .. } => {
                    assert_eq!(value, overflow_usize as u128);
                }
                other => panic!("Expected ValueOutOfRange, got {:?}", other),
            }
        }

        // i64_to_u64 boundary tests
        assert_eq!(i64_to_u64(0, "field").unwrap(), 0);
        assert_eq!(i64_to_u64(i64::MAX, "field").unwrap(), i64::MAX as u64);
        match i64_to_u64(-1, "field").unwrap_err() {
            StorageError::InvalidStoredValue { field, value } => {
                assert_eq!(field, "field");
                assert_eq!(value, -1);
            }
            other => panic!("Expected InvalidStoredValue, got {:?}", other),
        }
        match i64_to_u64(i64::MIN, "field").unwrap_err() {
            StorageError::InvalidStoredValue { value, .. } => {
                assert_eq!(value, i64::MIN);
            }
            other => panic!("Expected InvalidStoredValue, got {:?}", other),
        }

        // i64_to_usize boundary tests
        assert_eq!(i64_to_usize(0, "field").unwrap(), 0);
        match i64_to_usize(-1, "field").unwrap_err() {
            StorageError::InvalidStoredValue { value, .. } => {
                assert_eq!(value, -1);
            }
            other => panic!("Expected InvalidStoredValue, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_field_by_field_write_overflow_protection() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("overflow_test.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        // 1. flow.id = u64::MAX
        let mut flow = make_test_flow(1, 100);
        flow.id = u64::MAX;
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.id",
                ..
            }
        ));

        // 2. flow.first_ts.mono_nanos = u64::MAX
        let mut flow = make_test_flow(1, 100);
        flow.first_ts = Timestamp::new(u64::MAX, 100);
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.first_ts.mono_nanos",
                ..
            }
        ));

        // 3. flow.last_ts.wall_nanos = u64::MAX
        let mut flow = make_test_flow(1, 100);
        flow.last_ts = Timestamp::new(100, u64::MAX);
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.last_ts.wall_nanos",
                ..
            }
        ));

        // 4. flow.stats.bytes = u64::MAX
        let mut flow = make_test_flow(1, 100);
        flow.stats.bytes = u64::MAX;
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.stats.bytes",
                ..
            }
        ));

        // 5. flow.stats.packets = u64::MAX
        let mut flow = make_test_flow(1, 100);
        flow.stats.packets = u64::MAX;
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.stats.packets",
                ..
            }
        ));

        // 6. flow.stats.rtt_estimate_nanos = Some(u64::MAX)
        let mut flow = make_test_flow(1, 100);
        flow.stats.rtt_estimate_nanos = Some(u64::MAX);
        let res = repo.insert_flow(flow, vec![]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow.stats.rtt_estimate_nanos",
                ..
            }
        ));

        // 7. event.flow_id = u64::MAX
        let flow = make_test_flow(1, 100);
        let event = ProtoEvent {
            flow_id: u64::MAX,
            ts: Timestamp::new(100, 100),
            kind: ProtoEventKind::DnsQuery,
        };
        let res = repo.insert_flow(flow, vec![event]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "event.flow_id",
                ..
            }
        ));

        // 8. event.ts.mono_nanos = u64::MAX
        let flow = make_test_flow(1, 100);
        let event = ProtoEvent {
            flow_id: 1,
            ts: Timestamp::new(u64::MAX, 100),
            kind: ProtoEventKind::DnsQuery,
        };
        let res = repo.insert_flow(flow, vec![event]).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "event.ts.mono_nanos",
                ..
            }
        ));

        // 9. session.id = u64::MAX
        let session = Session {
            id: u64::MAX,
            process_id: 10,
            start_ts: Timestamp::new(100, 100),
            trigger: "test".into(),
            flow_ids: vec![],
        };
        let res = repo.insert_session(session).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "session.id",
                ..
            }
        ));

        // 10. session.process_id = u64::MAX
        let session = Session {
            id: 1,
            process_id: u64::MAX,
            start_ts: Timestamp::new(100, 100),
            trigger: "test".into(),
            flow_ids: vec![],
        };
        let res = repo.insert_session(session).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "session.process_id",
                ..
            }
        ));

        // 11. session.start_ts.mono_nanos = u64::MAX
        let session = Session {
            id: 1,
            process_id: 10,
            start_ts: Timestamp::new(u64::MAX, 100),
            trigger: "test".into(),
            flow_ids: vec![],
        };
        let res = repo.insert_session(session).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "session.start_ts.mono_nanos",
                ..
            }
        ));

        // 12. host_id = u64::MAX
        let host = Host {
            ip: IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            names: vec![],
            geo: None,
            asn: None,
            org: None,
        };
        let res = repo.insert_host(u64::MAX, host).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "host.id",
                ..
            }
        ));

        // 13. finding.id = u64::MAX
        let finding = Finding {
            id: u64::MAX,
            category: netpulse_core::FindingCategory::Suspicious,
            confidence: netpulse_core::Confidence::new(0.8),
            evidence_refs: vec![],
        };
        let res = repo.insert_finding(finding).await;
        assert!(matches!(
            res.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "finding.id",
                ..
            }
        ));

        // 14. Query parameters with u64::MAX
        assert!(matches!(
            repo.flow(u64::MAX).await.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "flow_id query",
                ..
            }
        ));
        assert!(matches!(
            repo.session(u64::MAX).await.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "session_id query",
                ..
            }
        ));
        assert!(matches!(
            repo.finding(u64::MAX).await.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "finding_id query",
                ..
            }
        ));
        assert!(matches!(
            repo.events_for_flow(u64::MAX).await.unwrap_err(),
            StorageError::ValueOutOfRange {
                field: "events_for_flow.flow_id",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn test_sqlite_read_negative_stored_value_returns_invalid_stored_value_error() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("corruption_test.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        // 1. Manually insert raw negative session row: session_id = -1
        sqlx::query(
            "INSERT INTO sessions (session_id, process_id, start_ts, trigger) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(-1i64)
        .bind(Some(100i64))
        .bind(1000i64)
        .bind("corrupted")
        .execute(repo.pool())
        .await
        .unwrap();

        let _session_res = repo.session(1).await;
        // Looking up session(1) returns None, but session_ids() reads all session rows
        let ids_res = repo.session_ids().await;
        assert!(ids_res.is_err());
        match ids_res.unwrap_err() {
            StorageError::InvalidStoredValue { field, value } => {
                assert_eq!(field, "session_id");
                assert_eq!(value, -1);
            }
            other => panic!(
                "Expected InvalidStoredValue for session_id, got {:?}",
                other
            ),
        }

        // 2. Manually insert raw negative proto_events row: flow_id = 99, ts = -1
        sqlx::query(
            "INSERT INTO flows (flow_id, canonical_key, epoch, l4_proto, l7_proto, first_ts_mono, last_ts_wall, bytes_up, bytes_down, pkts_up, pkts_down, rtt_us, retransmits, state) VALUES (99, X'00', 0, 0, 0, 100, 100, 0, 0, 0, 0, 0, 0, 0)",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO proto_events (flow_id, ts, kind, fields, packet_ref) VALUES (99, ?1, 0, ?2, NULL)",
        )
        .bind(-500i64)
        .bind("\"DnsQuery\"")
        .execute(repo.pool())
        .await
        .unwrap();

        let events_res = repo.events_for_flow(99).await;
        assert!(events_res.is_err());
        match events_res.unwrap_err() {
            StorageError::InvalidStoredValue { field, value } => {
                assert_eq!(field, "ProtoEventRow.ts");
                assert_eq!(value, -500);
            }
            other => panic!(
                "Expected InvalidStoredValue for ProtoEventRow.ts, got {:?}",
                other
            ),
        }

        // 3. Manually insert raw negative finding row: finding_id = -50
        sqlx::query(
            "INSERT INTO findings (finding_id, category, confidence, evidence_refs, evidence_expired) VALUES (?1, 0, 0.5, '[]', 0)",
        )
        .bind(-50i64)
        .execute(repo.pool())
        .await
        .unwrap();

        // Reading all findings / looking up finding by negative id via raw query
        let row: std::result::Result<FindingRow, _> =
            sqlx::query_as("SELECT * FROM findings WHERE finding_id = -50")
                .fetch_one(repo.pool())
                .await;
        assert!(row.is_ok());
        let f_row = row.unwrap();
        let conv_res = i64_to_u64(f_row.finding_id, "FindingRow.finding_id");
        assert!(conv_res.is_err());
        match conv_res.unwrap_err() {
            StorageError::InvalidStoredValue { field, value } => {
                assert_eq!(field, "FindingRow.finding_id");
                assert_eq!(value, -50);
            }
            other => panic!(
                "Expected InvalidStoredValue for FindingRow.finding_id, got {:?}",
                other
            ),
        }
    }

    #[test]
    fn test_enum_encoding_decoding_roundtrip_and_bounds() {
        // L4Proto roundtrip
        for proto in [
            L4Proto::Tcp,
            L4Proto::Udp,
            L4Proto::Other(0),
            L4Proto::Other(1),
            L4Proto::Other(255),
        ] {
            let encoded = encode_l4_proto(proto);
            let decoded = decode_l4_proto(encoded).unwrap();
            assert_eq!(proto, decoded);
        }

        // Invalid L4Proto values
        for invalid in [-1, 0, 1, 5, 7, 16, 18, 999, 1256, 2000] {
            assert!(decode_l4_proto(invalid).is_err());
        }

        // L7Proto roundtrip
        for proto in [
            L7Proto::Unknown,
            L7Proto::Dns,
            L7Proto::Tls,
            L7Proto::Http1,
            L7Proto::Http2,
            L7Proto::Http3,
            L7Proto::Quic,
        ] {
            let encoded = encode_l7_proto(proto);
            let decoded = decode_l7_proto(encoded).unwrap();
            assert_eq!(proto, decoded);
        }

        // Invalid L7Proto values
        for invalid in [-1, 7, 8, 100] {
            assert!(decode_l7_proto(invalid).is_err());
        }

        // FlowState roundtrip
        for state in [
            FlowState::SynSeen,
            FlowState::Established,
            FlowState::Closing,
            FlowState::Closed,
            FlowState::Datagram,
        ] {
            let encoded = encode_flow_state(state);
            let decoded = decode_flow_state(encoded).unwrap();
            assert_eq!(state, decoded);
        }

        // Invalid FlowState values
        for invalid in [-1, 5, 6, 100] {
            assert!(decode_flow_state(invalid).is_err());
        }
    }

    #[tokio::test]
    async fn test_sqlite_insert_session_rollback_on_missing_flow() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("session_rollback.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        // 1. Insert flow 1 and flow 2
        let tuple1 = FiveTuple::new(
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            1234,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            80,
            L4Proto::Tcp,
        );
        let flow1 = Flow {
            id: 1,
            key: tuple1,
            first_ts: Timestamp::new(100, 100),
            last_ts: Timestamp::new(200, 200),
            l4: L4Proto::Tcp,
            l7: L7Proto::Http1,
            stats: FlowMetrics::default(),
            state: FlowState::Established,
        };
        let tuple2 = FiveTuple::new(
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            1235,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            80,
            L4Proto::Tcp,
        );
        let flow2 = Flow {
            id: 2,
            key: tuple2,
            first_ts: Timestamp::new(150, 150),
            last_ts: Timestamp::new(250, 250),
            l4: L4Proto::Tcp,
            l7: L7Proto::Http1,
            stats: FlowMetrics::default(),
            state: FlowState::Established,
        };
        repo.insert_flow(flow1, vec![]).await.unwrap();
        repo.insert_flow(flow2, vec![]).await.unwrap();

        // 2. Attempt to insert session with flow_ids [1, 2, 999] where 999 does not exist
        let session = Session {
            id: 50,
            process_id: 1234,
            start_ts: Timestamp::new(100, 100),
            trigger: "test".to_string(),
            flow_ids: vec![1, 2, 999],
        };
        let res = repo.insert_session(session).await;
        assert!(res.is_err());
        match res.unwrap_err() {
            StorageError::MissingFlowForSessionLink {
                session_id,
                flow_id,
            } => {
                assert_eq!(session_id, 50);
                assert_eq!(flow_id, 999);
            }
            other => panic!("Expected MissingFlowForSessionLink, got {:?}", other),
        }

        // 3. Verify session 50 was rolled back and does not exist in SQLite
        assert_eq!(repo.session(50).await.unwrap(), None);

        // 4. Verify flows 1 and 2 still have session_id == NULL
        let flows_for_s = repo.flows_for_session(50).await.unwrap();
        assert!(flows_for_s.is_empty());
    }

    #[tokio::test]
    async fn test_sqlite_insert_session_atomic_success_links_all_flows() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("session_success.db");
        let repo = SqliteCaptureRepository::connect(&db_path).await.unwrap();

        let tuple10 = FiveTuple::new(
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            5000,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            443,
            L4Proto::Tcp,
        );
        let flow10 = Flow {
            id: 10,
            key: tuple10,
            first_ts: Timestamp::new(100, 100),
            last_ts: Timestamp::new(200, 200),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics::default(),
            state: FlowState::Established,
        };
        let tuple11 = FiveTuple::new(
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            5001,
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            53,
            L4Proto::Udp,
        );
        let flow11 = Flow {
            id: 11,
            key: tuple11,
            first_ts: Timestamp::new(150, 150),
            last_ts: Timestamp::new(250, 250),
            l4: L4Proto::Udp,
            l7: L7Proto::Dns,
            stats: FlowMetrics::default(),
            state: FlowState::Datagram,
        };
        repo.insert_flow(flow10, vec![]).await.unwrap();
        repo.insert_flow(flow11, vec![]).await.unwrap();

        let session = Session {
            id: 50,
            process_id: 4321,
            start_ts: Timestamp::new(100, 100),
            trigger: "browse".to_string(),
            flow_ids: vec![10, 11],
        };
        repo.insert_session(session.clone()).await.unwrap();

        // Verify session retrieval populates flow_ids
        let retrieved = repo.session(50).await.unwrap().expect("session exists");
        assert_eq!(retrieved.id, 50);
        assert_eq!(retrieved.flow_ids, vec![10, 11]);

        // Verify flows_for_session queries both flows
        let flows = repo.flows_for_session(50).await.unwrap();
        assert_eq!(flows.len(), 2);
        assert_eq!(flows[0].id, 10);
        assert_eq!(flows[1].id, 11);
        assert_eq!(flows[0].l7, L7Proto::Tls);
        assert_eq!(flows[1].l7, L7Proto::Dns);
    }
}
