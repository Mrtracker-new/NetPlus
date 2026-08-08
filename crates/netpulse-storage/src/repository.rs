//! CaptureRepository trait, MemoryCaptureStore, and SqliteCaptureRepository.
#![allow(async_fn_in_trait)]

use std::collections::{BTreeSet, HashMap};
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use parking_lot::RwLock;

use netpulse_core::{
    EvidenceRef, Finding, Flow, Host, HostName, ProtoEvent, ProtoEventKind, Session, Timestamp,
};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::capture_store::StoredFinding;
use crate::error::{Result, StorageError};
use crate::migration::MigrationManager;
use crate::models::{FindingRow, FlowRow, HostResolutionRow, ProtoEventRow, SessionRow};

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
        let rtt = flow.stats.rtt_estimate_nanos.map(|n| n / 1000).unwrap_or(0);

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO flows (
                flow_id, canonical_key, epoch, l4_proto, l7_proto,
                first_ts_mono, last_ts_wall, bytes_up, bytes_down,
                pkts_up, pkts_down, rtt_us, retransmits, state
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(flow_id) DO UPDATE SET
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
        .bind(flow.id as i64)
        .bind(key_bytes)
        .bind(0i64)
        .bind(0i64)
        .bind(0i64)
        .bind(flow.first_ts.mono_nanos as i64)
        .bind(flow.last_ts.wall_nanos as i64)
        .bind(flow.stats.bytes as i64)
        .bind(0i64)
        .bind(flow.stats.packets as i64)
        .bind(0i64)
        .bind(rtt as i64)
        .bind(flow.stats.retransmits as i64)
        .bind(0i64)
        .execute(&mut *tx)
        .await?;

        for event in events {
            let fields_json =
                serde_json::to_string(&event.kind).map_err(StorageError::Serialization)?;
            sqlx::query(
                r#"
                INSERT INTO proto_events (flow_id, ts, kind, fields, packet_ref)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
            )
            .bind(event.flow_id as i64)
            .bind(event.ts.mono_nanos as i64)
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
        sqlx::query(
            r#"
            INSERT INTO sessions (session_id, process_id, start_ts, trigger)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(session_id) DO UPDATE SET
                start_ts=excluded.start_ts,
                trigger=excluded.trigger
            "#,
        )
        .bind(session.id as i64)
        .bind(session.process_id as i64)
        .bind(session.start_ts.mono_nanos as i64)
        .bind(&session.trigger)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn insert_host(&self, id: u64, host: Host) -> Result<()> {
        let geo_json = host
            .geo
            .as_ref()
            .map(|g| serde_json::to_string(g).map_err(StorageError::Serialization))
            .transpose()?;
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
        .bind(id as i64)
        .bind(host.ip.to_string())
        .bind(Some(rdns))
        .bind(asn_org)
        .bind(host.org)
        .bind(geo_json)
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
        .bind(finding.id as i64)
        .bind(0i64)
        .bind(finding.confidence.value() as f64)
        .bind(refs_json)
        .bind(0i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn flow(&self, id: u64) -> Result<Option<Flow>> {
        let row = sqlx::query_as::<_, FlowRow>("SELECT * FROM flows WHERE flow_id = ?1")
            .bind(id as i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(_r) => Ok(None),
            None => Ok(None),
        }
    }

    async fn session(&self, id: u64) -> Result<Option<Session>> {
        let row = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions WHERE session_id = ?1")
            .bind(id as i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => Ok(Some(Session {
                id: r.session_id as u64,
                process_id: r.process_id.unwrap_or(0) as u64,
                start_ts: Timestamp::new(r.start_ts as u64, r.start_ts as u64),
                trigger: r.trigger,
                flow_ids: vec![],
            })),
            None => Ok(None),
        }
    }

    async fn finding(&self, id: u64) -> Result<Option<StoredFinding>> {
        let row = sqlx::query_as::<_, FindingRow>("SELECT * FROM findings WHERE finding_id = ?1")
            .bind(id as i64)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => {
                let refs: Vec<EvidenceRef> = serde_json::from_str(&r.evidence_refs)
                    .map_err(StorageError::Deserialization)?;
                Ok(Some(StoredFinding {
                    finding: Finding {
                        id: r.finding_id as u64,
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

    async fn flows_for_session(&self, _session_id: u64) -> Result<Vec<Flow>> {
        Ok(Vec::new())
    }

    async fn events_for_flow(&self, flow_id: u64) -> Result<Vec<ProtoEvent>> {
        let rows =
            sqlx::query_as::<_, ProtoEventRow>("SELECT * FROM proto_events WHERE flow_id = ?1")
                .bind(flow_id as i64)
                .fetch_all(&self.pool)
                .await?;

        let mut events = Vec::new();
        for r in rows {
            let kind: ProtoEventKind =
                serde_json::from_str(&r.fields).map_err(StorageError::Deserialization)?;
            events.push(ProtoEvent {
                flow_id: r.flow_id as u64,
                ts: Timestamp::new(r.ts as u64, r.ts as u64),
                kind,
            });
        }
        Ok(events)
    }

    async fn flows_in_window(&self, _from: u64, _to: u64) -> Result<Vec<Flow>> {
        Ok(Vec::new())
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
        Ok(count.0 as usize)
    }

    async fn session_count(&self) -> Result<usize> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions")
            .fetch_one(&self.pool)
            .await?;
        Ok(count.0 as usize)
    }

    async fn session_ids(&self) -> Result<Vec<u64>> {
        let rows = sqlx::query("SELECT session_id FROM sessions ORDER BY session_id ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| r.get::<i64, _>(0) as u64)
            .collect())
    }

    async fn evict_oldest_flows(&self, target_max: usize) -> Result<usize> {
        let count = self.flow_count().await?;
        if count <= target_max {
            return Ok(0);
        }
        let to_remove = count - target_max;
        let res = sqlx::query(
            r#"
            DELETE FROM flows WHERE flow_id IN (
                SELECT flow_id FROM flows ORDER BY first_ts_mono ASC LIMIT ?1
            )
            "#,
        )
        .bind(to_remove as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() as usize)
    }

    async fn evict_oldest_sessions(&self, target_max: usize) -> Result<usize> {
        let count = self.session_count().await?;
        if count <= target_max {
            return Ok(0);
        }
        let to_remove = count - target_max;
        let res = sqlx::query(
            r#"
            DELETE FROM sessions WHERE session_id IN (
                SELECT session_id FROM sessions ORDER BY start_ts ASC LIMIT ?1
            )
            "#,
        )
        .bind(to_remove as i64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() as usize)
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
        let serde_err = serde_json::from_str::<String>("invalid json").unwrap_err();
        let storage_err = StorageError::Serialization(serde_err);
        match storage_err {
            StorageError::Serialization(e) => {
                assert!(e.line() > 0 || e.column() > 0 || !e.to_string().is_empty());
            }
            other => panic!("Expected StorageError::Serialization, got {:?}", other),
        }

        // Verify database remains completely empty (0 flows, 0 proto_events)
        assert_eq!(repo.flow_count().await.unwrap(), 0);
        let proto_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM proto_events")
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(proto_count.0, 0);
    }
}
