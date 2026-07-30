//! Remote Fleet Observation Agent.

use netpulse_core::{HostHealthMetrics, HostIdentity};

#[derive(Debug)]
pub struct FleetAgent {
    pub identity: HostIdentity,
    pub health: HostHealthMetrics,
}

impl FleetAgent {
    pub fn new(hostname: String, os: String) -> Self {
        Self {
            identity: HostIdentity {
                host_id: format!("host-{}", hostname),
                hostname: hostname.clone(),
                friendly_name: Some(format!("Agent ({})", hostname)),
                os,
                platform: "x86_64".into(),
                agent_version: "0.1.0".into(),
            },
            health: HostHealthMetrics {
                status: "Online".into(),
                last_heartbeat_nanos: 1774880000000000000,
                capture_rate_pps: 1450,
                dropped_packets: 0,
                cpu_usage_pct: 2.1,
                agent_latency_ms: 1.4,
            },
        }
    }
}
