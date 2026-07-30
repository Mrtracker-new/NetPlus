//! Type-safe SQLite database row models using `sqlx::FromRow`.

use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct FlowRow {
    pub flow_id: i64,
    pub canonical_key: Vec<u8>,
    pub epoch: i64,
    pub l4_proto: i64,
    pub l7_proto: i64,
    pub first_ts_mono: i64,
    pub last_ts_wall: i64,
    pub bytes_up: i64,
    pub bytes_down: i64,
    pub pkts_up: i64,
    pub pkts_down: i64,
    pub rtt_us: i64,
    pub retransmits: i64,
    pub state: i64,
    pub process_id: Option<i64>,
    pub session_id: Option<i64>,
    pub host_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct SessionRow {
    pub session_id: i64,
    pub process_id: Option<i64>,
    pub start_ts: i64,
    pub trigger: String,
    pub causal_graph: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct ProtoEventRow {
    pub event_id: i64,
    pub flow_id: i64,
    pub ts: i64,
    pub kind: i64,
    pub fields: String,
    pub packet_ref: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct FindingRow {
    pub finding_id: i64,
    pub category: i64,
    pub confidence: f64,
    pub session_id: Option<i64>,
    pub evidence_refs: String,
    pub evidence_expired: i64,
}

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct HostRow {
    pub host_id: i64,
    pub ip: String,
    pub rdns: Option<String>,
    pub asn_org: Option<String>,
    pub cdn: Option<String>,
    pub geo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct HostResolutionRow {
    pub ip: String,
    pub name: String,
    pub source: String,
}
