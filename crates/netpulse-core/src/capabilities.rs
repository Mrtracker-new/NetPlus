//! Subsystem Capability Registry & Dependency Graph.
//!
//! Exposes centralized capability detection and prerequisite chains for UI and plugins.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityNode {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub prerequisites: Vec<String>,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsCapabilities {
    pub supports_raw_sockets: bool,
    pub supports_icmp_ping: bool,
    pub supports_traceroute: bool,
    pub supports_bufferbloat: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxCapabilities {
    pub enabled: bool,
    pub supported_protocols: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerCapabilities {
    pub enabled: bool,
    pub active_runtimes: Vec<String>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FleetCapabilities {
    pub enabled: bool,
    pub supported_transports: Vec<String>,
    pub max_agents: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityRegistry {
    pub diagnostics: DiagnosticsCapabilities,
    pub sandbox: SandboxCapabilities,
    pub containers: ContainerCapabilities,
    pub fleet: FleetCapabilities,
    pub nodes: Vec<CapabilityNode>,
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        Self {
            diagnostics: DiagnosticsCapabilities {
                supports_raw_sockets: true,
                supports_icmp_ping: true,
                supports_traceroute: true,
                supports_bufferbloat: true,
                unavailable_reason: None,
            },
            sandbox: SandboxCapabilities {
                enabled: true,
                supported_protocols: vec![
                    "Ethernet".into(),
                    "ARP".into(),
                    "IPv4".into(),
                    "IPv6".into(),
                    "ICMP".into(),
                    "UDP".into(),
                    "TCP".into(),
                    "DHCP".into(),
                    "DNS".into(),
                    "HTTP/1.1".into(),
                    "HTTP/2".into(),
                    "HTTP/3".into(),
                    "TLS".into(),
                    "QUIC".into(),
                ],
            },
            containers: ContainerCapabilities {
                enabled: true,
                active_runtimes: vec!["Docker".into(), "Podman".into(), "WSL2".into()],
                unavailable_reason: None,
            },
            fleet: FleetCapabilities {
                enabled: true,
                supported_transports: vec!["LocalIPC".into(), "TCP".into(), "QUIC".into()],
                max_agents: 64,
            },
            nodes: vec![
                CapabilityNode {
                    id: "sys.raw_socket".into(),
                    name: "Raw Socket Access".into(),
                    enabled: true,
                    prerequisites: vec![],
                    failure_reason: None,
                },
                CapabilityNode {
                    id: "diag.traceroute".into(),
                    name: "Multi-Transport Traceroute".into(),
                    enabled: true,
                    prerequisites: vec!["sys.raw_socket".into()],
                    failure_reason: None,
                },
            ],
        }
    }
}
