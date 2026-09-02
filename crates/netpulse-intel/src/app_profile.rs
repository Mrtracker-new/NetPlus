//! Application security profiles and baselines.
//!
//! Separates learned observed baselines ([`ObservedProfile`]) from user-configured security policies
//! ([`ConfiguredPolicy`]). Compares active traffic against both to spot profile breaches.

use netpulse_core::EvidenceRef;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;

use crate::finding::{FindingKind, SecurityFinding};
use crate::view::TrafficView;

/// Minimum observations required before an [`ObservedProfile`] is considered mature enough to flag departures.
pub const MIN_PROFILE_OBSERVATIONS: u64 = 5;

/// Learned statistical baseline for an application process.
#[derive(Debug, Clone, PartialEq)]
pub struct ObservedProfile {
    pub process_name: String,
    pub observation_count: u64,
    pub rolling_byte_mean: f64,
    pub rolling_byte_m2: f64,
    pub rolling_packet_mean: f64,
    pub rolling_packet_m2: f64,
    pub known_destinations: HashSet<IpAddr>,
    pub known_ports: HashSet<u16>,
    pub last_update_ts_nanos: u64,
}

impl ObservedProfile {
    pub fn new(process_name: impl Into<String>) -> Self {
        Self {
            process_name: process_name.into(),
            observation_count: 0,
            rolling_byte_mean: 0.0,
            rolling_byte_m2: 0.0,
            rolling_packet_mean: 0.0,
            rolling_packet_m2: 0.0,
            known_destinations: HashSet::new(),
            known_ports: HashSet::new(),
            last_update_ts_nanos: 0,
        }
    }

    /// Record a new observation for this application process.
    pub fn observe(
        &mut self,
        bytes: u64,
        packets: u64,
        dst_ip: IpAddr,
        dst_port: u16,
        ts_nanos: u64,
    ) {
        self.observation_count += 1;
        let count = self.observation_count as f64;

        // Welford byte update
        let b_val = bytes as f64;
        let b_delta = b_val - self.rolling_byte_mean;
        self.rolling_byte_mean += b_delta / count;
        let b_delta2 = b_val - self.rolling_byte_mean;
        self.rolling_byte_m2 += b_delta * b_delta2;

        // Welford packet update
        let p_val = packets as f64;
        let p_delta = p_val - self.rolling_packet_mean;
        self.rolling_packet_mean += p_delta / count;
        let p_delta2 = p_val - self.rolling_packet_mean;
        self.rolling_packet_m2 += p_delta * p_delta2;

        self.known_destinations.insert(dst_ip);
        self.known_ports.insert(dst_port);
        self.last_update_ts_nanos = ts_nanos;
    }

    pub fn byte_std_dev(&self) -> f64 {
        if self.observation_count < 2 {
            0.0
        } else {
            (self.rolling_byte_m2 / (self.observation_count - 1) as f64).sqrt()
        }
    }
}

/// User-configured or system-level security policy bounds for an application.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ConfiguredPolicy {
    pub process_name: String,
    pub allowed_destinations: Option<HashSet<IpAddr>>,
    pub allowed_ports: Option<HashSet<u16>>,
    pub max_bytes_per_flow: Option<u64>,
}

/// A violation detected when comparing traffic against `ObservedProfile` and `ConfiguredPolicy`.
#[derive(Debug, Clone, PartialEq)]
pub enum ProfileViolation {
    UnapprovedDestination { ip: IpAddr },
    UnapprovedPort { port: u16 },
    ExcessiveVolume { bytes: u64, limit: u64 },
    ObservedDeviation { bytes: u64, mean: f64, z_score: f64 },
}

/// Profile store holding per-application profiles and policies.
#[derive(Debug, Clone, Default)]
pub struct AppProfileStore {
    observed: HashMap<String, ObservedProfile>,
    policies: HashMap<String, ConfiguredPolicy>,
}

impl AppProfileStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_policy(&mut self, policy: ConfiguredPolicy) {
        self.policies.insert(policy.process_name.clone(), policy);
    }

    pub fn observe_flow(
        &mut self,
        process_name: &str,
        bytes: u64,
        packets: u64,
        dst_ip: IpAddr,
        dst_port: u16,
        ts_nanos: u64,
    ) {
        self.observed
            .entry(process_name.to_string())
            .or_insert_with(|| ObservedProfile::new(process_name))
            .observe(bytes, packets, dst_ip, dst_port, ts_nanos);
    }

    /// Check traffic against profiles and policies to produce security findings.
    pub fn evaluate(&self, view: &TrafficView) -> Vec<SecurityFinding> {
        let mut findings = Vec::new();

        for f in view.flows {
            let proc_name = match view.process_of.get(&f.id) {
                Some(p) => &p.name,
                None => continue,
            };

            let mut violations = Vec::new();

            // Check against ConfiguredPolicy first
            if let Some(pol) = self.policies.get(proc_name) {
                if let Some(ref allowed_ips) = pol.allowed_destinations {
                    if !allowed_ips.contains(&f.key.dst_ip) {
                        violations
                            .push(ProfileViolation::UnapprovedDestination { ip: f.key.dst_ip });
                    }
                }
                if let Some(ref allowed_ports) = pol.allowed_ports {
                    if !allowed_ports.contains(&f.key.dst_port) {
                        violations.push(ProfileViolation::UnapprovedPort {
                            port: f.key.dst_port,
                        });
                    }
                }
                if let Some(max_b) = pol.max_bytes_per_flow {
                    if f.stats.bytes > max_b {
                        violations.push(ProfileViolation::ExcessiveVolume {
                            bytes: f.stats.bytes,
                            limit: max_b,
                        });
                    }
                }
            }

            // Check against ObservedProfile if mature
            if let Some(obs) = self.observed.get(proc_name) {
                if obs.observation_count >= MIN_PROFILE_OBSERVATIONS {
                    let sd = obs.byte_std_dev();
                    if sd > 0.0 {
                        let z = (f.stats.bytes as f64 - obs.rolling_byte_mean).abs() / sd;
                        if z > 4.0 && f.stats.bytes as f64 > obs.rolling_byte_mean {
                            violations.push(ProfileViolation::ObservedDeviation {
                                bytes: f.stats.bytes,
                                mean: obs.rolling_byte_mean,
                                z_score: z,
                            });
                        }
                    }
                }
            }

            if !violations.is_empty() {
                let desc: Vec<String> = violations
                    .iter()
                    .map(|v| match v {
                        ProfileViolation::UnapprovedDestination { ip } => {
                            format!("destination {ip} is not in allowed policy")
                        }
                        ProfileViolation::UnapprovedPort { port } => {
                            format!("port {port} is not in allowed policy")
                        }
                        ProfileViolation::ExcessiveVolume { bytes, limit } => {
                            format!("volume {bytes} bytes exceeds policy limit {limit}")
                        }
                        ProfileViolation::ObservedDeviation {
                            bytes,
                            mean,
                            z_score,
                        } => format!(
                            "volume {bytes} bytes deviates from observed mean {:.0} (z={:.1})",
                            mean, z_score
                        ),
                    })
                    .collect();

                let explanation = format!(
                    "Application '{}' breached its security profile: {}.",
                    proc_name,
                    desc.join("; ")
                );

                if let Some(finding) = SecurityFinding::observe(
                    FindingKind::AppProfileBreach,
                    0.7,
                    explanation,
                    vec![EvidenceRef::Flow(f.id)],
                ) {
                    findings.push(finding.with_technical(format!("Process: {proc_name}")));
                }
            }
        }

        findings
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Flow, FlowMetrics, FlowState, Process, Timestamp};
    use std::net::Ipv4Addr;

    #[test]
    fn profile_does_not_flag_before_min_observations() {
        let mut store = AppProfileStore::new();
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        // Add 2 observations (below MIN_PROFILE_OBSERVATIONS of 5)
        store.observe_flow("curl", 100, 2, ip, 80, 0);
        store.observe_flow("curl", 120, 2, ip, 80, 10);

        let flow = Flow {
            id: 1,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
                50000,
                ip,
                80,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(20, 20),
            last_ts: Timestamp::new(21, 21),
            l4: L4Proto::Tcp,
            l7: L7Proto::Http1,
            stats: FlowMetrics {
                bytes: 50_000,
                packets: 10,
                rtt_estimate_nanos: None,
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Closed,
        };

        let mut procs = HashMap::new();
        procs.insert(
            1,
            Process {
                pid: 123,
                name: "curl".into(),
                exe_path: "/usr/bin/curl".into(),
                signer: None,
                start_mono_nanos: 0,
                cpu_percent: None,
                memory_bytes: None,
            },
        );

        let flows = vec![flow];
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };

        let findings = store.evaluate(&view);
        assert!(
            findings.is_empty(),
            "Immature baseline must not flag deviation"
        );
    }

    #[test]
    fn policy_breach_flags_unapproved_port() {
        let mut store = AppProfileStore::new();
        let mut allowed_ports = HashSet::new();
        allowed_ports.insert(80);
        allowed_ports.insert(443);

        store.set_policy(ConfiguredPolicy {
            process_name: "curl".into(),
            allowed_destinations: None,
            allowed_ports: Some(allowed_ports),
            max_bytes_per_flow: None,
        });

        let ip = IpAddr::V4(Ipv4Addr::new(198, 51, 100, 99));
        let flow = Flow {
            id: 1,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 2)),
                50000,
                ip,
                4444,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(0, 0),
            last_ts: Timestamp::new(1, 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Unknown,
            stats: FlowMetrics {
                bytes: 500,
                packets: 5,
                rtt_estimate_nanos: None,
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Closed,
        };

        let mut procs = HashMap::new();
        procs.insert(
            1,
            Process {
                pid: 456,
                name: "curl".into(),
                exe_path: "/usr/bin/curl".into(),
                signer: None,
                start_mono_nanos: 0,
                cpu_percent: None,
                memory_bytes: None,
            },
        );

        let flows = vec![flow];
        let view = TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };

        let findings = store.evaluate(&view);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::AppProfileBreach);
        assert!(findings[0]
            .explanation
            .contains("port 4444 is not in allowed policy"));
    }
}
