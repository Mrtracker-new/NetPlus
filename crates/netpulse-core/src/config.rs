//! Typed Application Configuration Service.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TracerouteTransportMode {
    Icmp,
    Udp,
    TcpSyn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    pub default_traceroute_transport: TracerouteTransportMode,
    pub bufferbloat_max_bandwidth_mbps: u32,
    pub max_fleet_agents: u32,
    pub indexer_chunk_size: usize,
    pub explanation_confidence_threshold: f32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            default_traceroute_transport: TracerouteTransportMode::Icmp,
            bufferbloat_max_bandwidth_mbps: 100,
            max_fleet_agents: 32,
            indexer_chunk_size: 1000,
            explanation_confidence_threshold: 0.7,
        }
    }
}
