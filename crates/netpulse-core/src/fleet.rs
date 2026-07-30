//! Fleet Observation Data Types & Host Health Telemetry.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostIdentity {
    pub host_id: String,
    pub hostname: String,
    pub friendly_name: Option<String>,
    pub os: String,
    pub platform: String,
    pub agent_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostHealthMetrics {
    pub status: String, // "Online", "Offline", "Degraded"
    pub last_heartbeat_nanos: u64,
    pub capture_rate_pps: u64,
    pub dropped_packets: u64,
    pub cpu_usage_pct: f32,
    pub agent_latency_ms: f32,
}
