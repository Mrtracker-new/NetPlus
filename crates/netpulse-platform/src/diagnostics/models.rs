//! Diagnostics Data Models & Progress Event Structures.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DiagnosticProgressEvent {
    StageChanged { stage: String },
    HopDiscovered { ttl: u8, ip: String, rtt_ms: f32 },
    RttSample { sample_index: u32, rtt_ms: f32 },
    PhaseUpdated { phase: String, pct_complete: u8 },
    Finished { summary: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingProbeOutput {
    pub target: String,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f32,
    pub min_rtt_ms: f32,
    pub avg_rtt_ms: f32,
    pub max_rtt_ms: f32,
    pub stddev_rtt_ms: f32,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteHop {
    pub ttl: u8,
    pub ip: String,
    pub hostname: Option<String>,
    pub rtt_ms: f32,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteOutput {
    pub target: String,
    pub hops: Vec<TracerouteHop>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferbloatOutput {
    pub target: String,
    pub idle_rtt_ms: f32,
    pub loaded_rtt_ms: f32,
    pub delta_rtt_ms: f32,
    pub grade: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDiscoveryOutput {
    pub gateway_ip: Option<String>,
    pub interface_name: Option<String>,
    pub status: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsProbeOutput {
    pub target: String,
    pub resolution_rtt_ms: Option<f32>,
    pub resolved_ips: Vec<String>,
    pub timed_out: bool,
    pub error: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProbeOutput {
    pub url: String,
    pub status_code: Option<u16>,
    pub connect_ms: Option<f32>,
    pub ttfb_ms: Option<f32>,
    pub transfer_ms: Option<f32>,
    pub tls_ms: Option<f32>,
    pub error: Option<String>,
    pub limitation: Option<String>,
    pub source: String,
}
