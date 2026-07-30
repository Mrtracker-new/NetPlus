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
pub struct PingProbeOutput {
    pub target: String,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f32,
    pub min_rtt_ms: f32,
    pub avg_rtt_ms: f32,
    pub max_rtt_ms: f32,
    pub stddev_rtt_ms: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub ttl: u8,
    pub ip: String,
    pub hostname: Option<String>,
    pub rtt_ms: f32,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TracerouteOutput {
    pub target: String,
    pub hops: Vec<TracerouteHop>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BufferbloatOutput {
    pub target: String,
    pub idle_rtt_ms: f32,
    pub loaded_rtt_ms: f32,
    pub delta_rtt_ms: f32,
    pub grade: String,
}
