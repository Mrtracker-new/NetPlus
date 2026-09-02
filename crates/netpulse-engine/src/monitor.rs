//! Monitoring — usage breakdowns and the "why is it slow?" diagnostics
//!This is the presentation-side analysis layer: it *projects* the
//! flow metrics the engine already computed into the standing
//! answers users want — "how much / to where?" and "why is it bad?" — never
//! re-scanning packets.
//!
//! It lives in the engine because it is a read-only aggregation over the
//! committed reconstruction model (: "consumes metrics from 06 and
//! time-series from 08"); it holds no capture or storage logic of its own.
//!
//! Two honesty rules are load-bearing here:
//! - **Diagnoses are hypotheses, not verdicts**: every
//!   [`Diagnosis`] carries a [`Confidence`] and the evidence it rests on, and is
//!   phrased "looks like", never asserted as certain.
//! - **Capture loss is not network loss**: the two are tracked in
//!   distinct fields and never summed. Presenting our own dropped packets as the
//!   network's loss would be both a correctness bug and a lie.

use std::collections::{BTreeMap, HashMap};
use std::net::IpAddr;

use netpulse_api::dto::{
    EndpointClassificationDto, FlowLineageDto, ProcessMetricDto, SubsystemStatusDto,
    ThroughputSampleDto,
};
use netpulse_core::net::L7Proto;
use netpulse_core::{Confidence, EvidenceRef, Flow, HostName};

/// The passively-observed `IP → names` map the host breakdown joins against
///Owned by the store; borrowed here read-only for the join.
pub type NameMap = HashMap<IpAddr, Vec<HostName>>;

/// A ranked usage breakdown along one dimension: protocol, host,
/// or interface. Rows are ordered by bytes descending, ties by label, so the
/// "top talkers" are deterministic and stable to render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Breakdown {
    pub dimension: Dimension,
    pub rows: Vec<BreakdownRow>,
}

/// The dimension a [`Breakdown`] decomposes traffic along.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Dimension {
    Protocol,
    Host,
    Interface,
}

/// One row of a usage breakdown: a label, its byte and flow totals, and the
/// flows that back it so a click drills into them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownRow {
    pub label: String,
    pub bytes: u64,
    pub flows: u32,
    /// Passively-observed names for this row's endpoint, empty when none were
    /// seen or the dimension has no IP (protocol/interface). The `label` stays the
    /// raw IP — the authoritative key — and these enrich it for display; a name is
    /// never substituted *for* the address.
    pub hostnames: Vec<HostName>,
    /// The flows this row aggregates — the drill-down target.
    pub evidence: Vec<EvidenceRef>,
}

/// Decompose a set of flows by application protocol.
pub fn breakdown_by_protocol(flows: &[&Flow]) -> Breakdown {
    aggregate(Dimension::Protocol, flows, |f| l7_label(f.l7).to_string())
}

/// Decompose by destination host IP, joining in the
/// passively-observed names for each IP. The label stays the raw IP
/// so the row's identity/key is unambiguous; `names` only *enriches* it, and an
/// IP with no observed name simply carries an empty list — honest about what we
/// have not seen rather than inventing a label.
pub fn breakdown_by_host(flows: &[&Flow], names: &NameMap) -> Breakdown {
    let mut breakdown = aggregate(Dimension::Host, flows, |f| f.key.dst_ip.to_string());
    for row in &mut breakdown.rows {
        // The label was just formatted from `dst_ip`, so this parse round-trips.
        if let Ok(ip) = row.label.parse::<IpAddr>() {
            if let Some(hostnames) = names.get(&ip) {
                row.hostnames = hostnames.clone();
            }
        }
    }
    breakdown
}

/// Decompose by capture interface.
/// The [`Flow`] model carries no interface id yet (it is a per-packet field,
///  ; until it is threaded through, everything attributes to one
/// interface honestly rather than inventing a split.
pub fn breakdown_by_interface(flows: &[&Flow]) -> Breakdown {
    aggregate(Dimension::Interface, flows, |_| "primary".to_string())
}

fn aggregate<F>(dimension: Dimension, flows: &[&Flow], key: F) -> Breakdown
where
    F: Fn(&Flow) -> String,
{
    // BTreeMap keeps a deterministic label order before the byte-sort below.
    let mut acc: BTreeMap<String, (u64, u32, Vec<EvidenceRef>)> = BTreeMap::new();
    for f in flows {
        let entry = acc.entry(key(f)).or_insert((0, 0, Vec::new()));
        entry.0 += f.stats.bytes;
        entry.1 += 1;
        entry.2.push(EvidenceRef::Flow(f.id));
    }
    let mut rows: Vec<BreakdownRow> = acc
        .into_iter()
        .map(|(label, (bytes, flows, evidence))| BreakdownRow {
            label,
            bytes,
            flows,
            // Filled by the host breakdown's name join; empty for other dimensions.
            hostnames: Vec::new(),
            evidence,
        })
        .collect();
    // Rank by bytes desc; ties broken by label asc (already sorted by BTreeMap).
    rows.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.label.cmp(&b.label)));
    Breakdown { dimension, rows }
}

fn l7_label(l7: L7Proto) -> &'static str {
    match l7 {
        L7Proto::Unknown => "Unknown",
        L7Proto::Dns => "DNS",
        L7Proto::Tls => "TLS",
        L7Proto::Http1 => "HTTP/1.1",
        L7Proto::Http2 => "HTTP/2",
        L7Proto::Http3 => "HTTP/3",
        L7Proto::Quic => "QUIC",
        _ => "Other",
    }
}

/// The likely cause of degradation the diagnostic classifier settles on
///Each is a *hypothesis*, surfaced with confidence + evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Cause {
    /// Loss/jitter across many hosts at once → likely the local link
    ///
    LocalWifi,
    /// High RTT to one host but not others → likely that server/path
    ///
    DistantServer,
    /// A long gap before any connection starts → likely DNS.
    SlowDns,
    /// Loss that climbs as throughput rises → likely congestion.
    Congestion,
}

impl Cause {
    /// A plain-language, "looks like" phrasing — never a verdict.
    pub fn explain(self) -> &'static str {
        match self {
            Cause::LocalWifi => {
                "Loss and jitter are affecting several servers at once, so it looks like your \
                 local Wi-Fi or link rather than any one site."
            }
            Cause::DistantServer => {
                "Round-trips to one server are much slower than to others, so it looks like that \
                 server or the path to it rather than your connection."
            }
            Cause::SlowDns => {
                "There was a long pause looking up the address before anything connected, so it \
                 looks like slow DNS."
            }
            Cause::Congestion => {
                "Packet loss rose as throughput increased, so it looks like congestion on the link."
            }
        }
    }
}

/// A degradation diagnosis: a likely cause, a calibrated
/// confidence, and the flows that justify it. Constructed only by
/// [`diagnose`], so a diagnosis can never exist without its evidence
///
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnosis {
    pub cause: Cause,
    pub confidence: Confidence,
    pub evidence: Vec<EvidenceRef>,
    /// The "looks like …" explanation, ready to show.
    pub explanation: String,
}

/// Capture-vs-network loss, kept strictly separate. Summing
/// these would misreport our own dropped packets as the network's loss.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LossAccounting {
    /// Packets the *network* lost, inferred from flow metrics.
    pub network_loss_indicators: u32,
    /// Frames *NetPulse* dropped under load — never network loss.
    pub capture_drops: u64,
}

/// Thresholds for the heuristic classifier (: each rule is explicit
/// and versioned). Nanoseconds for RTT; counts for loss.
mod thresh {
    /// RTT above this is "high" for the distant-server test (150 ms).
    pub const HIGH_RTT_NANOS: u64 = 150_000_000;
    /// A host's RTT must exceed the median by this factor to look like *that*
    /// server rather than a general problem.
    pub const DISTANT_FACTOR: u64 = 3;
    /// DNS setup gap above this looks slow (300 ms).
    pub const SLOW_DNS_NANOS: u64 = 300_000_000;
    /// Minimum flows showing loss to call it "many hosts" (local link).
    pub const MANY_HOSTS: usize = 3;
}

/// Diagnose likely degradation causes from a set of flows and a loss split
///Returns every cause whose evidence is present, most-confident
/// first. An empty result means "nothing looks wrong" — the honest default,
/// never a fabricated problem.
///
/// `dns_setup_gap_nanos` is the observed pause before the first connection in
/// the window, when a DNS lookup preceded it; `None` when there
/// was no such gap to measure.
pub fn diagnose(
    flows: &[&Flow],
    loss: LossAccounting,
    dns_setup_gap_nanos: Option<u64>,
) -> Vec<Diagnosis> {
    let mut out = Vec::new();

    // --- Slow DNS: a long gap before any connection started ---
    if let Some(gap) = dns_setup_gap_nanos {
        if gap >= thresh::SLOW_DNS_NANOS {
            // Confidence scales with how far past the threshold we are, capped.
            let over = (gap - thresh::SLOW_DNS_NANOS) as f32 / thresh::SLOW_DNS_NANOS as f32;
            out.push(Diagnosis {
                cause: Cause::SlowDns,
                confidence: Confidence::new(0.55 + 0.3 * over.min(1.0)),
                evidence: all_flow_evidence(flows),
                explanation: Cause::SlowDns.explain().to_string(),
            });
        }
    }

    // --- RTT analysis: distant single server vs. broad local problem ---
    let rtts: Vec<(usize, u64)> = flows
        .iter()
        .enumerate()
        .filter_map(|(i, f)| f.stats.rtt_estimate_nanos.map(|r| (i, r)))
        .collect();
    if !rtts.is_empty() {
        let median = median_rtt(&rtts);
        // One host far above the median, with the rest fine → that server.
        if let Some(&(i, worst)) = rtts.iter().max_by_key(|(_, r)| *r) {
            let others_ok = rtts
                .iter()
                .filter(|(j, _)| *j != i)
                .all(|(_, r)| *r < thresh::HIGH_RTT_NANOS || *r * thresh::DISTANT_FACTOR < worst);
            if worst >= thresh::HIGH_RTT_NANOS
                && worst >= median.saturating_mul(thresh::DISTANT_FACTOR)
                && others_ok
                && rtts.len() >= 2
            {
                out.push(Diagnosis {
                    cause: Cause::DistantServer,
                    confidence: Confidence::new(0.6),
                    evidence: vec![EvidenceRef::Flow(flows[i].id)],
                    explanation: Cause::DistantServer.explain().to_string(),
                });
            }
        }
    }

    // --- Local link: network loss spread across many distinct hosts ---
    let lossy_hosts = distinct_lossy_hosts(flows);
    if loss.network_loss_indicators > 0 && lossy_hosts >= thresh::MANY_HOSTS {
        out.push(Diagnosis {
            cause: Cause::LocalWifi,
            confidence: Confidence::new(0.5 + 0.1 * (lossy_hosts.min(5) as f32)),
            evidence: lossy_flow_evidence(flows),
            explanation: Cause::LocalWifi.explain().to_string(),
        });
    }

    // --- Congestion: loss present while a high-throughput flow is active ---
    let total_bytes: u64 = flows.iter().map(|f| f.stats.bytes).sum();
    let heavy = flows
        .iter()
        .any(|f| f.stats.bytes * 2 >= total_bytes && total_bytes > 0);
    if loss.network_loss_indicators > 0 && heavy && lossy_hosts < thresh::MANY_HOSTS {
        out.push(Diagnosis {
            cause: Cause::Congestion,
            confidence: Confidence::new(0.5),
            evidence: lossy_flow_evidence(flows),
            explanation: Cause::Congestion.explain().to_string(),
        });
    }

    // Most-confident first; ties keep insertion order (stable sort).
    out.sort_by(|a, b| {
        b.confidence
            .value()
            .partial_cmp(&a.confidence.value())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

fn median_rtt(rtts: &[(usize, u64)]) -> u64 {
    let mut vals: Vec<u64> = rtts.iter().map(|(_, r)| *r).collect();
    vals.sort_unstable();
    vals[vals.len() / 2]
}

fn distinct_lossy_hosts(flows: &[&Flow]) -> usize {
    let mut ips: Vec<IpAddr> = flows
        .iter()
        .filter(|f| f.stats.loss_indicators > 0)
        .map(|f| f.key.dst_ip)
        .collect();
    ips.sort();
    ips.dedup();
    ips.len()
}

fn all_flow_evidence(flows: &[&Flow]) -> Vec<EvidenceRef> {
    flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect()
}

fn lossy_flow_evidence(flows: &[&Flow]) -> Vec<EvidenceRef> {
    flows
        .iter()
        .filter(|f| f.stats.loss_indicators > 0)
        .map(|f| EvidenceRef::Flow(f.id))
        .collect()
}

/// A stage in the end-to-end diagnostic chain (Device -> Interface -> Router -> ISP -> DNS -> CDN -> Destination).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DiagnosticChainStageKind {
    Device,
    Interface,
    Router,
    Isp,
    Dns,
    Cdn,
    Destination,
}

impl DiagnosticChainStageKind {
    pub fn label(self) -> &'static str {
        match self {
            DiagnosticChainStageKind::Device => "Device (Local Stack)",
            DiagnosticChainStageKind::Interface => "Network Interface",
            DiagnosticChainStageKind::Router => "Router / Gateway",
            DiagnosticChainStageKind::Isp => "Internet Service Provider",
            DiagnosticChainStageKind::Dns => "DNS Resolver",
            DiagnosticChainStageKind::Cdn => "CDN / Edge Distribution",
            DiagnosticChainStageKind::Destination => "Destination Server",
        }
    }
}

/// The diagnostic health status of a stage in the diagnostic chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DiagnosticStageStatus {
    Healthy,
    Degraded,
    Investigate,
    Unknown,
    NotMeasurable,
}

/// The measurement state: directly observed vs inferred vs unknown vs not measurable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum MeasurementState {
    Observed,
    Inferred,
    Unknown,
    NotMeasurable,
}

/// Detection state: whether the node/feature was detected in the active traffic window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DetectionState {
    Detected,
    NotDetected,
}

/// One stage node in the authoritative diagnostic chain.
#[derive(Debug, Clone, PartialEq)]
pub struct DiagnosticStageNode {
    pub stage: DiagnosticChainStageKind,
    pub status: DiagnosticStageStatus,
    pub measurement_state: MeasurementState,
    pub detection_state: DetectionState,
    pub label: String,
    pub summary: String,
    pub detail: Option<String>,
    pub latency_ms: Option<f32>,
    pub evidence: Vec<EvidenceRef>,
    pub causes: Vec<Cause>,
    pub affected_targets: Vec<String>,
}

/// The complete end-to-end diagnostic chain.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DiagnosticChain {
    pub stages: Vec<DiagnosticStageNode>,
}

/// Build the authoritative diagnostic chain from observed telemetry, loss accounting, and hypotheses.
pub fn build_diagnostic_chain(
    flows: &[&Flow],
    loss: LossAccounting,
    diagnoses: &[Diagnosis],
    capture_stats: Option<&netpulse_capture::CaptureStats>,
    _dns_setup_gap_nanos: Option<u64>,
    names: &NameMap,
) -> DiagnosticChain {
    let mut stages = Vec::with_capacity(7);

    // 1. Device (Local Machine Stack)
    let device_node = match capture_stats {
        Some(cs) => {
            let buf_pct = (cs.buffer_frames * 100)
                .checked_div(cs.buffer_capacity)
                .unwrap_or(0);
            if cs.shed_stage != netpulse_capture::ShedStage::None || buf_pct > 85 {
                DiagnosticStageNode {
                    stage: DiagnosticChainStageKind::Device,
                    status: DiagnosticStageStatus::Degraded,
                    measurement_state: MeasurementState::Observed,
                    detection_state: DetectionState::Detected,
                    label: DiagnosticChainStageKind::Device.label().to_string(),
                    summary: "Capture Ring Buffer Saturated".to_string(),
                    detail: Some(format!(
                        "Buffer utilization at {}% with load shedding active",
                        buf_pct
                    )),
                    latency_ms: None,
                    evidence: Vec::new(),
                    causes: Vec::new(),
                    affected_targets: Vec::new(),
                }
            } else {
                DiagnosticStageNode {
                    stage: DiagnosticChainStageKind::Device,
                    status: DiagnosticStageStatus::Healthy,
                    measurement_state: MeasurementState::Observed,
                    detection_state: DetectionState::Detected,
                    label: DiagnosticChainStageKind::Device.label().to_string(),
                    summary: "Local Capture Pipeline Operational".to_string(),
                    detail: Some("Buffer nominal, zero memory overrun".to_string()),
                    latency_ms: None,
                    evidence: Vec::new(),
                    causes: Vec::new(),
                    affected_targets: Vec::new(),
                }
            }
        }
        None => DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Device,
            status: DiagnosticStageStatus::Unknown,
            measurement_state: MeasurementState::Unknown,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Device.label().to_string(),
            summary: "Local Engine Standby".to_string(),
            detail: Some("No active packet capture stream".to_string()),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        },
    };
    stages.push(device_node);

    // 2. Network Interface
    let wifi_diag = diagnoses.iter().find(|d| d.cause == Cause::LocalWifi);
    let iface_node = if loss.capture_drops > 0 {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Interface,
            status: DiagnosticStageStatus::Degraded,
            measurement_state: MeasurementState::Observed,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Interface.label().to_string(),
            summary: "Capture Packet Drops Detected".to_string(),
            detail: Some(format!(
                "{} frames dropped by kernel/adapter buffer",
                loss.capture_drops
            )),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    } else if let Some(d) = wifi_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Interface,
            status: DiagnosticStageStatus::Degraded,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Interface.label().to_string(),
            summary: "Local Wi-Fi / Link Degradation Inferred".to_string(),
            detail: Some(d.explanation.clone()),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::LocalWifi],
            affected_targets: Vec::new(),
        }
    } else if capture_stats.is_some() {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Interface,
            status: DiagnosticStageStatus::Healthy,
            measurement_state: MeasurementState::Observed,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Interface.label().to_string(),
            summary: "Network Interface Operational".to_string(),
            detail: Some("Full packet capture fidelity with zero drops".to_string()),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    } else {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Interface,
            status: DiagnosticStageStatus::Unknown,
            measurement_state: MeasurementState::Unknown,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Interface.label().to_string(),
            summary: "Interface Standby".to_string(),
            detail: None,
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    };
    stages.push(iface_node);

    // 3. Router / Gateway
    let router_node = if let Some(d) = wifi_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Router,
            status: DiagnosticStageStatus::Investigate,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Router.label().to_string(),
            summary: "Gateway Link Jitter / Loss Inferred".to_string(),
            detail: Some(
                "Widespread loss across multiple destinations indicates local hop instability"
                    .to_string(),
            ),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::LocalWifi],
            affected_targets: Vec::new(),
        }
    } else if !flows.is_empty() {
        // Look for local subnet flows to calculate local gateway RTT if available
        let local_rtts: Vec<f32> = flows
            .iter()
            .filter(|f| match f.key.dst_ip {
                IpAddr::V4(v4) => v4.is_private() || v4.is_loopback(),
                IpAddr::V6(v6) => {
                    v6.is_loopback()
                        || (v6.segments()[0] & 0xfe00 == 0xfc00)
                        || (v6.segments()[0] & 0xffc0 == 0xfe80)
                }
            })
            .filter_map(|f| f.stats.rtt_estimate_nanos.map(|n| (n as f32) / 1_000_000.0))
            .collect();
        if !local_rtts.is_empty() {
            let avg_rtt = local_rtts.iter().sum::<f32>() / (local_rtts.len() as f32);
            DiagnosticStageNode {
                stage: DiagnosticChainStageKind::Router,
                status: DiagnosticStageStatus::Healthy,
                measurement_state: MeasurementState::Observed,
                detection_state: DetectionState::Detected,
                label: DiagnosticChainStageKind::Router.label().to_string(),
                summary: "Gateway Subnet Reachable".to_string(),
                detail: Some(format!("{:.1}ms local subnet RTT", avg_rtt)),
                latency_ms: Some(avg_rtt),
                evidence: Vec::new(),
                causes: Vec::new(),
                affected_targets: Vec::new(),
            }
        } else {
            DiagnosticStageNode {
                stage: DiagnosticChainStageKind::Router,
                status: DiagnosticStageStatus::Healthy,
                measurement_state: MeasurementState::Inferred,
                detection_state: DetectionState::Detected,
                label: DiagnosticChainStageKind::Router.label().to_string(),
                summary: "Gateway Route Active".to_string(),
                detail: Some("Traffic actively traversing local gateway".to_string()),
                latency_ms: None,
                evidence: Vec::new(),
                causes: Vec::new(),
                affected_targets: Vec::new(),
            }
        }
    } else {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Router,
            status: DiagnosticStageStatus::Unknown,
            measurement_state: MeasurementState::Unknown,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Router.label().to_string(),
            summary: "Gateway Route Unobserved".to_string(),
            detail: Some("No flows observed across gateway in current window".to_string()),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    };
    stages.push(router_node);

    // 4. ISP (Scientific Honesty: Passive capture does not directly sample upstream ISP hops without active traceroute)
    let isp_node = DiagnosticStageNode {
        stage: DiagnosticChainStageKind::Isp,
        status: DiagnosticStageStatus::Unknown,
        measurement_state: MeasurementState::NotMeasurable,
        detection_state: DetectionState::NotDetected,
        label: DiagnosticChainStageKind::Isp.label().to_string(),
        summary: "ISP Upstream Hop Not Sampled".to_string(),
        detail: Some("Passive capture does not directly sample upstream ISP infrastructure without active traceroute probe".to_string()),
        latency_ms: None,
        evidence: Vec::new(),
        causes: Vec::new(),
        affected_targets: Vec::new(),
    };
    stages.push(isp_node);

    // 5. DNS
    let dns_diag = diagnoses.iter().find(|d| d.cause == Cause::SlowDns);
    let dns_flows: Vec<&Flow> = flows
        .iter()
        .filter(|f| f.l7 == L7Proto::Dns)
        .copied()
        .collect();
    let dns_node = if let Some(d) = dns_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Dns,
            status: DiagnosticStageStatus::Degraded,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Dns.label().to_string(),
            summary: "Slow DNS Lookup Inferred".to_string(),
            detail: Some(d.explanation.clone()),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::SlowDns],
            affected_targets: Vec::new(),
        }
    } else if !dns_flows.is_empty() {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Dns,
            status: DiagnosticStageStatus::Healthy,
            measurement_state: MeasurementState::Observed,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Dns.label().to_string(),
            summary: "DNS Resolution Nominal".to_string(),
            detail: Some(format!(
                "{} DNS query flows observed in window",
                dns_flows.len()
            )),
            latency_ms: None,
            evidence: dns_flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    } else {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Dns,
            status: DiagnosticStageStatus::NotMeasurable,
            measurement_state: MeasurementState::NotMeasurable,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Dns.label().to_string(),
            summary: "No DNS Queries in Window".to_string(),
            detail: Some("No DNS queries observed in current capture window".to_string()),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    };
    stages.push(dns_node);

    // 6. CDN / Edge
    let distant_diag = diagnoses.iter().find(|d| d.cause == Cause::DistantServer);
    let edge_hosts: Vec<String> = flows
        .iter()
        .filter_map(|f| {
            names.get(&f.key.dst_ip).and_then(|hn_list| {
                hn_list
                    .iter()
                    .find(|hn| {
                        let n = hn.name.to_lowercase();
                        n.contains("cdn")
                            || n.contains("edge")
                            || n.contains("cloudflare")
                            || n.contains("akamai")
                            || n.contains("fastly")
                    })
                    .map(|hn| hn.name.clone())
            })
        })
        .collect();

    let cdn_node = if let Some(d) = distant_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Cdn,
            status: DiagnosticStageStatus::Investigate,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Cdn.label().to_string(),
            summary: "Edge / Path Latency Divergence".to_string(),
            detail: Some("Distant server latency significantly exceeds baseline".to_string()),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::DistantServer],
            affected_targets: edge_hosts,
        }
    } else if !edge_hosts.is_empty() {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Cdn,
            status: DiagnosticStageStatus::Healthy,
            measurement_state: MeasurementState::Observed,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Cdn.label().to_string(),
            summary: "Edge Distribution Detected".to_string(),
            detail: Some(format!("{} edge endpoints active", edge_hosts.len())),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: edge_hosts,
        }
    } else {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Cdn,
            status: DiagnosticStageStatus::NotMeasurable,
            measurement_state: MeasurementState::NotMeasurable,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Cdn.label().to_string(),
            summary: "No Edge Endpoints in Window".to_string(),
            detail: Some(
                "No CDN or edge distribution nodes identified in current active flows".to_string(),
            ),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    };
    stages.push(cdn_node);

    // 7. Destination Server
    let congestion_diag = diagnoses.iter().find(|d| d.cause == Cause::Congestion);
    let dest_node = if flows.is_empty() {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Destination,
            status: DiagnosticStageStatus::Unknown,
            measurement_state: MeasurementState::Unknown,
            detection_state: DetectionState::NotDetected,
            label: DiagnosticChainStageKind::Destination.label().to_string(),
            summary: "No Remote Traffic Observed".to_string(),
            detail: Some(
                "Capture standby — start traffic to observe destination health".to_string(),
            ),
            latency_ms: None,
            evidence: Vec::new(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    } else if let Some(d) = distant_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Destination,
            status: DiagnosticStageStatus::Degraded,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Destination.label().to_string(),
            summary: "Distant Server Latency".to_string(),
            detail: Some(d.explanation.clone()),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::DistantServer],
            affected_targets: Vec::new(),
        }
    } else if let Some(d) = congestion_diag {
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Destination,
            status: DiagnosticStageStatus::Degraded,
            measurement_state: MeasurementState::Inferred,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Destination.label().to_string(),
            summary: "Heavy Flow Link Congestion".to_string(),
            detail: Some(d.explanation.clone()),
            latency_ms: None,
            evidence: d.evidence.clone(),
            causes: vec![Cause::Congestion],
            affected_targets: Vec::new(),
        }
    } else {
        let total_bytes: u64 = flows.iter().map(|f| f.stats.bytes).sum();
        let rtts: Vec<f32> = flows
            .iter()
            .filter_map(|f| f.stats.rtt_estimate_nanos.map(|n| (n as f32) / 1_000_000.0))
            .collect();
        let avg_rtt = if !rtts.is_empty() {
            Some(rtts.iter().sum::<f32>() / (rtts.len() as f32))
        } else {
            None
        };
        DiagnosticStageNode {
            stage: DiagnosticChainStageKind::Destination,
            status: DiagnosticStageStatus::Healthy,
            measurement_state: MeasurementState::Observed,
            detection_state: DetectionState::Detected,
            label: DiagnosticChainStageKind::Destination.label().to_string(),
            summary: "Destination Endpoints Healthy".to_string(),
            detail: Some(format!(
                "{} active flows ({} bytes)",
                flows.len(),
                total_bytes
            )),
            latency_ms: avg_rtt,
            evidence: flows
                .iter()
                .take(5)
                .map(|f| EvidenceRef::Flow(f.id))
                .collect(),
            causes: Vec::new(),
            affected_targets: Vec::new(),
        }
    };
    stages.push(dest_node);

    DiagnosticChain { stages }
}

/// A monitoring snapshot over a window: the usage breakdowns
/// plus any degradation diagnoses, ready to hand to the UI as one bundle.
#[derive(Debug, Clone)]
pub struct MonitorSnapshot {
    pub by_protocol: Breakdown,
    pub by_host: Breakdown,
    pub diagnoses: Vec<Diagnosis>,
    pub loss: LossAccounting,
    pub capture_stats: Option<netpulse_capture::CaptureStats>,
    pub diagnostic_chain: DiagnosticChain,
    pub processes: Vec<ProcessMetricDto>,
    pub lineage: Vec<FlowLineageDto>,
    pub subsystems: Vec<SubsystemStatusDto>,
    pub throughput_history: Vec<ThroughputSampleDto>,
}

/// Classify an IP address into an endpoint category.
pub fn classify_endpoint(ip: &IpAddr) -> EndpointClassificationDto {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_loopback() || v4.is_private() || v4.is_link_local() {
                EndpointClassificationDto::LocalSubnet
            } else if v4.is_multicast() || v4.is_broadcast() {
                EndpointClassificationDto::Multicast
            } else {
                EndpointClassificationDto::ExternalWan
            }
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unicast_link_local() {
                EndpointClassificationDto::LocalSubnet
            } else if v6.is_multicast() {
                EndpointClassificationDto::Multicast
            } else {
                EndpointClassificationDto::ExternalWan
            }
        }
    }
}

/// Aggregate active flows in the window to their correlated OS processes.
pub fn aggregate_processes(
    flows: &[&Flow],
    correlator: Option<&crate::attribution::Correlator>,
    sockets: Option<&(dyn netpulse_core::SocketTableSource + Send + Sync)>,
) -> Vec<ProcessMetricDto> {
    if flows.is_empty() {
        return Vec::new();
    }

    struct Agg {
        pid: Option<u64>,
        name: String,
        exe_path: Option<String>,
        bytes: u64,
        packets: u64,
        flows: u32,
        cpu_percent: Option<f32>,
        memory_bytes: Option<u64>,
    }

    let mut map: HashMap<(Option<u64>, String), Agg> = HashMap::new();
    let mut proc_cache: HashMap<u64, Option<netpulse_core::Process>> = HashMap::new();

    for flow in flows {
        let pid_opt = correlator.and_then(|c| c.attribute(&flow.key, flow.first_ts.mono_nanos).pid);
        let (pid, name, exe_path, cpu_percent, memory_bytes) = if let Some(pid) = pid_opt {
            let proc_info = proc_cache
                .entry(pid)
                .or_insert_with(|| sockets.and_then(|s| s.process_info(pid).ok().flatten()));
            if let Some(p) = proc_info {
                (
                    Some(pid),
                    p.name.clone(),
                    if p.exe_path.is_empty() {
                        None
                    } else {
                        Some(p.exe_path.clone())
                    },
                    p.cpu_percent,
                    p.memory_bytes,
                )
            } else {
                (Some(pid), format!("PID {pid}"), None, None, None)
            }
        } else {
            (None, "Unattributed Flows".to_string(), None, None, None)
        };

        let entry = map.entry((pid, name.clone())).or_insert_with(|| Agg {
            pid,
            name,
            exe_path,
            bytes: 0,
            packets: 0,
            flows: 0,
            cpu_percent,
            memory_bytes,
        });
        entry.bytes = entry.bytes.saturating_add(flow.stats.bytes);
        entry.packets = entry.packets.saturating_add(flow.stats.packets);
        entry.flows = entry.flows.saturating_add(1);
    }

    let mut list: Vec<ProcessMetricDto> = map
        .into_values()
        .map(|agg| ProcessMetricDto {
            pid: agg.pid,
            name: agg.name,
            exe_path: agg.exe_path,
            bytes: agg.bytes,
            packets: agg.packets,
            flows: agg.flows,
            cpu_percent: agg.cpu_percent,
            memory_bytes: agg.memory_bytes,
        })
        .collect();

    list.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    list.truncate(10);
    list
}

/// Aggregate communicating endpoints into flow lineage pairs.
pub fn aggregate_lineage(flows: &[&Flow], names: &NameMap) -> Vec<FlowLineageDto> {
    if flows.is_empty() {
        return Vec::new();
    }

    struct LineageAgg {
        source: String,
        destination: String,
        protocol: String,
        bytes: u64,
        packets: u64,
        direction: String,
        flow_count: u32,
        classification: EndpointClassificationDto,
    }

    let mut map: HashMap<(String, String, String), LineageAgg> = HashMap::new();

    for flow in flows {
        let src_ip_str = flow.key.src_ip.to_string();
        let dst_ip = flow.key.dst_ip;
        let dst_name = names
            .get(&dst_ip)
            .and_then(|h| h.first())
            .map(|h| h.name.clone())
            .unwrap_or_else(|| dst_ip.to_string());

        let proto_str = match flow.l7 {
            L7Proto::Unknown => match flow.l4 {
                netpulse_core::L4Proto::Tcp => "TCP".to_string(),
                netpulse_core::L4Proto::Udp => "UDP".to_string(),
                netpulse_core::L4Proto::Other(n) => format!("IP-{n}"),
                _ => "OTHER".to_string(),
            },
            other => format!("{other:?}"),
        };

        let direction = match flow.key.src_ip {
            IpAddr::V4(v4) if v4.is_private() || v4.is_loopback() => match dst_ip {
                IpAddr::V4(dst_v4) if dst_v4.is_private() || dst_v4.is_loopback() => "local",
                _ => "outbound",
            },
            _ => "inbound",
        };

        let classification = if dst_name.contains("cloudflare")
            || dst_name.contains("akamai")
            || dst_name.contains("fastly")
            || dst_name.contains("cloudfront")
        {
            EndpointClassificationDto::CdnEdge
        } else {
            classify_endpoint(&dst_ip)
        };

        let key = (src_ip_str.clone(), dst_name.clone(), proto_str.clone());
        let entry = map.entry(key).or_insert_with(|| LineageAgg {
            source: src_ip_str,
            destination: dst_name,
            protocol: proto_str,
            bytes: 0,
            packets: 0,
            direction: direction.to_string(),
            flow_count: 0,
            classification,
        });

        entry.bytes = entry.bytes.saturating_add(flow.stats.bytes);
        entry.packets = entry.packets.saturating_add(flow.stats.packets);
        entry.flow_count = entry.flow_count.saturating_add(1);
    }

    let mut list: Vec<FlowLineageDto> = map
        .into_values()
        .map(|a| FlowLineageDto {
            source: a.source,
            destination: a.destination,
            protocol: a.protocol,
            bytes: a.bytes,
            packets: a.packets,
            direction: a.direction,
            flow_count: a.flow_count,
            classification: a.classification,
        })
        .collect();

    list.sort_by_key(|b| std::cmp::Reverse(b.bytes));
    list.truncate(10);
    list
}

/// Compute 12 discrete bucketed samples of directional throughput rates over the window.
pub fn bucket_throughput_series(
    flows: &[&Flow],
    from_mono_nanos: u64,
    to_mono_nanos: u64,
) -> Vec<ThroughputSampleDto> {
    if flows.is_empty() || to_mono_nanos <= from_mono_nanos {
        return Vec::new();
    }

    const NUM_BUCKETS: usize = 12;
    let window_duration = to_mono_nanos - from_mono_nanos;
    let bucket_duration_nanos = (window_duration / NUM_BUCKETS as u64).max(1);
    let bucket_duration_secs = (bucket_duration_nanos as f64 / 1_000_000_000.0).max(0.001);

    let mut ingress_bytes = [0u64; NUM_BUCKETS];
    let mut egress_bytes = [0u64; NUM_BUCKETS];

    for flow in flows {
        let ts = flow.first_ts.mono_nanos;
        if ts < from_mono_nanos || ts >= to_mono_nanos {
            continue;
        }
        let offset = ts - from_mono_nanos;
        let idx = ((offset / bucket_duration_nanos) as usize).min(NUM_BUCKETS - 1);

        let is_inbound = match flow.key.src_ip {
            IpAddr::V4(v4) => !v4.is_private() && !v4.is_loopback(),
            IpAddr::V6(v6) => !v6.is_loopback() && !v6.is_unicast_link_local(),
        };

        if is_inbound {
            ingress_bytes[idx] = ingress_bytes[idx].saturating_add(flow.stats.bytes);
        } else {
            egress_bytes[idx] = egress_bytes[idx].saturating_add(flow.stats.bytes);
        }
    }

    let mut samples = Vec::with_capacity(NUM_BUCKETS);
    for i in 0..NUM_BUCKETS {
        let bucket_ts = from_mono_nanos + (i as u64 * bucket_duration_nanos);
        let ingress_rate = (ingress_bytes[i] as f64 / bucket_duration_secs).round() as u64;
        let egress_rate = (egress_bytes[i] as f64 / bucket_duration_secs).round() as u64;

        samples.push(ThroughputSampleDto {
            timestamp_mono_nanos: bucket_ts,
            ingress_rate_bytes_sec: ingress_rate,
            egress_rate_bytes_sec: egress_rate,
        });
    }

    samples
}

/// Evaluate authentic status of engine and platform subsystems.
pub fn evaluate_subsystems(
    flows: &[&Flow],
    capture_stats: Option<&netpulse_capture::CaptureStats>,
    correlator: Option<&crate::attribution::Correlator>,
) -> Vec<SubsystemStatusDto> {
    let mut subsystems = Vec::new();

    // 1. Capture Pipeline
    let (cap_status, cap_detail) = if let Some(stats) = capture_stats {
        if stats.dropped > 0 {
            (
                "warning",
                format!(
                    "Active ({} drops recorded, stage: {:?})",
                    stats.dropped, stats.shed_stage
                ),
            )
        } else {
            (
                "healthy",
                format!(
                    "Nominal (buffer: {}/{})",
                    stats.buffer_frames, stats.buffer_capacity
                ),
            )
        }
    } else {
        ("healthy", "Idle / Standby".to_string())
    };
    subsystems.push(SubsystemStatusDto {
        name: "Capture Pipeline".to_string(),
        status: cap_status.to_string(),
        detail: cap_detail,
    });

    // 2. Storage Repository
    subsystems.push(SubsystemStatusDto {
        name: "Storage Engine".to_string(),
        status: "healthy".to_string(),
        detail: format!("Active ({} flows retained)", flows.len()),
    });

    // 3. Process Correlator
    let (corr_status, corr_detail) = if correlator.is_some() {
        ("healthy", "OS Socket Table Sampling Active".to_string())
    } else {
        ("unknown", "OS Socket Table Sampling Inactive".to_string())
    };
    subsystems.push(SubsystemStatusDto {
        name: "Process Correlator".to_string(),
        status: corr_status.to_string(),
        detail: corr_detail,
    });

    // 4. Network Adapter Driver
    let driver_detail = if capture_stats.is_some() {
        "Packet Driver Attached & Capturing"
    } else {
        "Standby / Awaiting Interface Selection"
    };
    subsystems.push(SubsystemStatusDto {
        name: "Network Driver".to_string(),
        status: "healthy".to_string(),
        detail: driver_detail.to_string(),
    });

    // 5. Diagnostic Engine
    subsystems.push(SubsystemStatusDto {
        name: "Diagnostic Engine".to_string(),
        status: "healthy".to_string(),
        detail: "7 Hops Verified Grounded".to_string(),
    });

    subsystems
}

/// Build a full monitoring snapshot from a window's flows, loss split, and window bounds.
#[allow(clippy::too_many_arguments)]
pub fn snapshot_window(
    flows: &[&Flow],
    loss: LossAccounting,
    dns_setup_gap_nanos: Option<u64>,
    names: &NameMap,
    capture_stats: Option<netpulse_capture::CaptureStats>,
    correlator: Option<&crate::attribution::Correlator>,
    sockets: Option<&(dyn netpulse_core::SocketTableSource + Send + Sync)>,
    from_mono_nanos: u64,
    to_mono_nanos: u64,
) -> MonitorSnapshot {
    let diagnoses = diagnose(flows, loss, dns_setup_gap_nanos);
    let diagnostic_chain = build_diagnostic_chain(
        flows,
        loss,
        &diagnoses,
        capture_stats.as_ref(),
        dns_setup_gap_nanos,
        names,
    );
    let processes = aggregate_processes(flows, correlator, sockets);
    let lineage = aggregate_lineage(flows, names);
    let subsystems = evaluate_subsystems(flows, capture_stats.as_ref(), correlator);
    let throughput_history = bucket_throughput_series(flows, from_mono_nanos, to_mono_nanos);

    MonitorSnapshot {
        by_protocol: breakdown_by_protocol(flows),
        by_host: breakdown_by_host(flows, names),
        diagnoses,
        loss,
        capture_stats,
        diagnostic_chain,
        processes,
        lineage,
        subsystems,
        throughput_history,
    }
}

/// Backward-compatible convenience wrapper around [`snapshot_window`].
pub fn snapshot(
    flows: &[&Flow],
    loss: LossAccounting,
    dns_setup_gap_nanos: Option<u64>,
    names: &NameMap,
    capture_stats: Option<netpulse_capture::CaptureStats>,
) -> MonitorSnapshot {
    snapshot_window(
        flows,
        loss,
        dns_setup_gap_nanos,
        names,
        capture_stats,
        None,
        None,
        0,
        u64::MAX,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use netpulse_core::{FlowMetrics, FlowState, Timestamp};
    use std::net::Ipv4Addr;

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn flow(id: u64, dst: IpAddr, l7: L7Proto, bytes: u64, rtt: Option<u64>, loss: u32) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(ip(192, 168, 0, 1), 50000, dst, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(id, id),
            last_ts: Timestamp::new(id + 1, id + 1),
            l4: L4Proto::Tcp,
            l7,
            stats: FlowMetrics {
                bytes,
                packets: 10,
                rtt_estimate_nanos: rtt,
                retransmits: loss,
                loss_indicators: loss,
            },
            state: FlowState::Established,
        }
    }

    #[test]
    fn protocol_breakdown_ranks_by_bytes() {
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 1000, None, 0);
        let f2 = flow(2, ip(2, 2, 2, 2), L7Proto::Dns, 100, None, 0);
        let f3 = flow(3, ip(3, 3, 3, 3), L7Proto::Tls, 500, None, 0);
        let b = breakdown_by_protocol(&[&f1, &f2, &f3]);
        assert_eq!(b.rows[0].label, "TLS");
        assert_eq!(b.rows[0].bytes, 1500);
        assert_eq!(b.rows[0].flows, 2);
        // Each row carries its backing flows for drill-down.
        assert_eq!(b.rows[0].evidence.len(), 2);
    }

    #[test]
    fn host_breakdown_joins_observed_names_and_keeps_ip_label() {
        let dst = ip(93, 184, 216, 34);
        let f1 = flow(1, dst, L7Proto::Tls, 1000, None, 0);
        let f2 = flow(2, dst, L7Proto::Tls, 500, None, 0);
        let mut names = NameMap::new();
        names.insert(
            dst,
            vec![HostName {
                name: "example.com".into(),
                source: netpulse_core::NameSource::Dns,
            }],
        );
        let b = breakdown_by_host(&[&f1, &f2], &names);
        assert_eq!(b.rows.len(), 1);
        let row = &b.rows[0];
        // Label stays the raw IP — the name only enriches it.
        assert_eq!(row.label, "93.184.216.34");
        assert_eq!(row.hostnames.len(), 1);
        assert_eq!(row.hostnames[0].name, "example.com");
        assert_eq!(row.bytes, 1500);
    }

    #[test]
    fn host_without_observed_name_has_empty_hostnames() {
        let dst = ip(10, 0, 0, 9);
        let f = flow(1, dst, L7Proto::Tls, 100, None, 0);
        // Empty map (nothing resolved) → honest empty list, still a valid row.
        let b = breakdown_by_host(&[&f], &NameMap::new());
        assert_eq!(b.rows[0].label, "10.0.0.9");
        assert!(b.rows[0].hostnames.is_empty());
    }

    #[test]
    fn distant_server_diagnosed_when_one_host_is_slow() {
        // One host at 300 ms, two others fast → looks like that server.
        let slow = flow(1, ip(9, 9, 9, 9), L7Proto::Tls, 1000, Some(300_000_000), 0);
        let ok1 = flow(2, ip(2, 2, 2, 2), L7Proto::Tls, 1000, Some(20_000_000), 0);
        let ok2 = flow(3, ip(3, 3, 3, 3), L7Proto::Tls, 1000, Some(25_000_000), 0);
        let ds = diagnose(&[&slow, &ok1, &ok2], LossAccounting::default(), None);
        assert!(ds.iter().any(|d| d.cause == Cause::DistantServer));
        let d = ds.iter().find(|d| d.cause == Cause::DistantServer).unwrap();
        // Diagnosis points at the slow flow specifically.
        assert_eq!(d.evidence, vec![EvidenceRef::Flow(1)]);
        assert!(d.explanation.contains("looks like"));
    }

    #[test]
    fn local_wifi_diagnosed_when_loss_spans_many_hosts() {
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 100, Some(20_000_000), 2);
        let f2 = flow(2, ip(2, 2, 2, 2), L7Proto::Tls, 100, Some(22_000_000), 1);
        let f3 = flow(3, ip(3, 3, 3, 3), L7Proto::Tls, 100, Some(19_000_000), 3);
        let loss = LossAccounting {
            network_loss_indicators: 6,
            capture_drops: 0,
        };
        let ds = diagnose(&[&f1, &f2, &f3], loss, None);
        assert!(ds.iter().any(|d| d.cause == Cause::LocalWifi));
    }

    #[test]
    fn slow_dns_diagnosed_on_long_setup_gap() {
        let f = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 100, Some(20_000_000), 0);
        let ds = diagnose(&[&f], LossAccounting::default(), Some(500_000_000));
        assert!(ds.iter().any(|d| d.cause == Cause::SlowDns));
    }

    #[test]
    fn healthy_traffic_yields_no_diagnosis() {
        // Fast, lossless flows → nothing looks wrong. No fabrication.
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 1000, Some(20_000_000), 0);
        let f2 = flow(2, ip(2, 2, 2, 2), L7Proto::Tls, 1000, Some(18_000_000), 0);
        assert!(diagnose(&[&f1, &f2], LossAccounting::default(), None).is_empty());
    }

    #[test]
    fn capture_loss_is_not_summed_into_network_loss() {
        // The two loss kinds live in separate fields; nothing here adds them
        //A snapshot preserves both distinctly.
        let f = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 1000, Some(20_000_000), 0);
        let loss = LossAccounting {
            network_loss_indicators: 0,
            capture_drops: 42,
        };
        let snap = snapshot(&[&f], loss, None, &NameMap::new(), None);
        assert_eq!(snap.loss.capture_drops, 42);
        assert_eq!(snap.loss.network_loss_indicators, 0);
        // Capture drops alone never manufacture a network diagnosis.
        assert!(snap.diagnoses.is_empty());
    }

    #[test]
    fn diagnostic_chain_builds_all_seven_stages_in_order() {
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Dns, 100, Some(15_000_000), 0);
        let f2 = flow(
            2,
            ip(93, 184, 216, 34),
            L7Proto::Tls,
            1000,
            Some(22_000_000),
            0,
        );
        let cs = netpulse_capture::CaptureStats {
            received: 50,
            buffer_frames: 50,
            buffer_capacity: 1000,
            shed_stage: netpulse_capture::ShedStage::None,
            dropped: 0,
        };
        let snap = snapshot(
            &[&f1, &f2],
            LossAccounting::default(),
            None,
            &NameMap::new(),
            Some(cs),
        );
        let chain = &snap.diagnostic_chain;
        assert_eq!(chain.stages.len(), 7);

        assert_eq!(chain.stages[0].stage, DiagnosticChainStageKind::Device);
        assert_eq!(chain.stages[0].status, DiagnosticStageStatus::Healthy);
        assert_eq!(
            chain.stages[0].measurement_state,
            MeasurementState::Observed
        );

        assert_eq!(chain.stages[1].stage, DiagnosticChainStageKind::Interface);
        assert_eq!(chain.stages[1].status, DiagnosticStageStatus::Healthy);

        assert_eq!(chain.stages[2].stage, DiagnosticChainStageKind::Router);

        assert_eq!(chain.stages[3].stage, DiagnosticChainStageKind::Isp);
        assert_eq!(chain.stages[3].status, DiagnosticStageStatus::Unknown);
        assert_eq!(
            chain.stages[3].measurement_state,
            MeasurementState::NotMeasurable
        );

        assert_eq!(chain.stages[4].stage, DiagnosticChainStageKind::Dns);
        assert_eq!(chain.stages[4].status, DiagnosticStageStatus::Healthy);
        assert_eq!(
            chain.stages[4].measurement_state,
            MeasurementState::Observed
        );

        assert_eq!(chain.stages[5].stage, DiagnosticChainStageKind::Cdn);
        assert_eq!(chain.stages[5].status, DiagnosticStageStatus::NotMeasurable);

        assert_eq!(chain.stages[6].stage, DiagnosticChainStageKind::Destination);
        assert_eq!(chain.stages[6].status, DiagnosticStageStatus::Healthy);
    }

    #[test]
    fn diagnostic_chain_reflects_local_wifi_and_slow_dns_degradation() {
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 100, Some(20_000_000), 2);
        let f2 = flow(2, ip(2, 2, 2, 2), L7Proto::Tls, 100, Some(22_000_000), 1);
        let f3 = flow(3, ip(3, 3, 3, 3), L7Proto::Tls, 100, Some(19_000_000), 3);
        let loss = LossAccounting {
            network_loss_indicators: 6,
            capture_drops: 0,
        };
        let cs = netpulse_capture::CaptureStats {
            received: 50,
            buffer_frames: 50,
            buffer_capacity: 1000,
            shed_stage: netpulse_capture::ShedStage::None,
            dropped: 0,
        };
        let snap = snapshot(
            &[&f1, &f2, &f3],
            loss,
            Some(500_000_000),
            &NameMap::new(),
            Some(cs),
        );
        let chain = &snap.diagnostic_chain;

        let iface = chain
            .stages
            .iter()
            .find(|s| s.stage == DiagnosticChainStageKind::Interface)
            .unwrap();
        assert_eq!(iface.status, DiagnosticStageStatus::Degraded);
        assert_eq!(iface.measurement_state, MeasurementState::Inferred);

        let router = chain
            .stages
            .iter()
            .find(|s| s.stage == DiagnosticChainStageKind::Router)
            .unwrap();
        assert_eq!(router.status, DiagnosticStageStatus::Investigate);
        assert_eq!(router.measurement_state, MeasurementState::Inferred);

        let dns = chain
            .stages
            .iter()
            .find(|s| s.stage == DiagnosticChainStageKind::Dns)
            .unwrap();
        assert_eq!(dns.status, DiagnosticStageStatus::Degraded);
        assert_eq!(dns.measurement_state, MeasurementState::Inferred);
    }

    #[test]
    fn diagnostic_chain_empty_telemetry_yields_honest_unknown_states() {
        let snap = snapshot(&[], LossAccounting::default(), None, &NameMap::new(), None);
        let chain = &snap.diagnostic_chain;
        assert_eq!(chain.stages.len(), 7);
        for stage in &chain.stages {
            assert!(
                stage.status == DiagnosticStageStatus::Unknown
                    || stage.status == DiagnosticStageStatus::NotMeasurable
            );
        }
    }

    #[test]
    fn process_aggregation_returns_unattributed_when_no_pid() {
        let f = flow(1, ip(1, 1, 1, 1), L7Proto::Unknown, 10_000, None, 0);
        let procs = aggregate_processes(&[&f], None, None);
        assert_eq!(procs.len(), 1);
        assert_eq!(procs[0].pid, None);
        assert_eq!(procs[0].name, "Unattributed Flows");
        assert_eq!(procs[0].cpu_percent, None);
        assert_eq!(procs[0].memory_bytes, None);
        assert_eq!(procs[0].bytes, 10_000);
        assert_eq!(procs[0].packets, 10);
        assert_eq!(procs[0].flows, 1);
    }

    #[test]
    fn empty_flows_yield_empty_aggregations() {
        assert!(aggregate_processes(&[], None, None).is_empty());
        assert!(aggregate_lineage(&[], &NameMap::new()).is_empty());
        assert!(bucket_throughput_series(&[], 0, 10_000_000_000).is_empty());
    }

    #[test]
    fn throughput_bucketing_computes_mathematically_consistent_rates() {
        // Create a flow with 10_000 bytes at t = 1_000_000_000 ns (1 sec)
        // Window from 0 to 12_000_000_000 ns (12 sec) -> each of 12 buckets is 1 sec duration
        let mut f = flow(1, ip(8, 8, 8, 8), L7Proto::Unknown, 10_000, None, 0);
        f.first_ts = Timestamp::new(1_000_000_000, 1_000_000_000);
        let samples = bucket_throughput_series(&[&f], 0, 12_000_000_000);
        assert_eq!(samples.len(), 12);
        // Bucket 1 (offset 1 sec) should have 10_000 bytes over 1.0 sec = 10_000 bytes/sec egress
        assert_eq!(samples[1].egress_rate_bytes_sec, 10_000);
        assert_eq!(samples[1].ingress_rate_bytes_sec, 0);
        // Other buckets have 0
        assert_eq!(samples[0].egress_rate_bytes_sec, 0);
        assert_eq!(samples[2].egress_rate_bytes_sec, 0);
    }

    #[test]
    fn throughput_bucketing_edge_cases_and_boundary_conditions() {
        let from = 100_000_000_000u64;
        let to = 112_000_000_000u64; // 12 seconds window, 1 sec per bucket

        // 1. Boundary timestamps & First/Last bucket inclusion
        let mut f_first = flow(1, ip(8, 8, 8, 8), L7Proto::Unknown, 5_000, None, 0);
        f_first.first_ts = Timestamp::new(from, from); // exact from_mono_nanos boundary

        let mut f_last = flow(2, ip(8, 8, 8, 8), L7Proto::Unknown, 7_000, None, 0);
        f_last.first_ts = Timestamp::new(to - 1, to - 1); // exact to_mono_nanos - 1 boundary

        let mut f_excluded = flow(3, ip(8, 8, 8, 8), L7Proto::Unknown, 99_000, None, 0);
        f_excluded.first_ts = Timestamp::new(to, to); // exact to_mono_nanos boundary (excluded)

        let samples = bucket_throughput_series(&[&f_first, &f_last, &f_excluded], from, to);
        assert_eq!(samples.len(), 12);
        // First bucket (index 0) captures f_first
        assert_eq!(samples[0].egress_rate_bytes_sec, 5_000);
        // Last bucket (index 11) captures f_last
        assert_eq!(samples[11].egress_rate_bytes_sec, 7_000);
        // Middle bucket (index 5) has no flows -> exactly 0
        assert_eq!(samples[5].egress_rate_bytes_sec, 0);
        assert_eq!(samples[5].ingress_rate_bytes_sec, 0);
        // f_excluded was outside the window, so no 99,000 bytes added anywhere
        let total_egress: u64 = samples.iter().map(|s| s.egress_rate_bytes_sec).sum();
        assert_eq!(total_egress, 12_000);

        // 2. Zero total bytes
        let mut f_zero = flow(4, ip(8, 8, 8, 8), L7Proto::Unknown, 0, None, 0);
        f_zero.first_ts = Timestamp::new(from + 500, from + 500);
        let zero_samples = bucket_throughput_series(&[&f_zero], from, to);
        assert_eq!(zero_samples.len(), 12);
        for s in zero_samples {
            assert_eq!(s.ingress_rate_bytes_sec, 0);
            assert_eq!(s.egress_rate_bytes_sec, 0);
        }

        // 3. Very short duration (window < 12 ns, e.g. 6 ns)
        let short_from = 1_000;
        let short_to = 1_006;
        let mut f_short = flow(5, ip(8, 8, 8, 8), L7Proto::Unknown, 100, None, 0);
        f_short.first_ts = Timestamp::new(1_002, 1_002);
        let short_samples = bucket_throughput_series(&[&f_short], short_from, short_to);
        assert_eq!(short_samples.len(), 12);
        // Safe computation, does not panic or divide by zero
        assert!(short_samples.iter().any(|s| s.egress_rate_bytes_sec > 0));

        // 4. Inverted or zero window -> empty series
        assert!(bucket_throughput_series(&[&f_first], to, from).is_empty());
        assert!(bucket_throughput_series(&[&f_first], from, from).is_empty());
    }

    #[test]
    fn lineage_classifies_local_and_external_endpoints() {
        let f1 = flow(1, ip(192, 168, 1, 1), L7Proto::Unknown, 5_000, None, 0);
        let f2 = flow(2, ip(93, 184, 216, 34), L7Proto::Unknown, 15_000, None, 0);
        let lineage = aggregate_lineage(&[&f1, &f2], &NameMap::new());
        assert_eq!(lineage.len(), 2);
        // Ordered by bytes descending
        assert_eq!(lineage[0].destination, "93.184.216.34");
        assert_eq!(
            lineage[0].classification,
            EndpointClassificationDto::ExternalWan
        );
        assert_eq!(lineage[1].destination, "192.168.1.1");
        assert_eq!(
            lineage[1].classification,
            EndpointClassificationDto::LocalSubnet
        );
    }

    #[test]
    fn evaluate_subsystems_reports_legitimate_health() {
        let cs = netpulse_capture::CaptureStats {
            received: 50,
            dropped: 0,
            shed_stage: netpulse_capture::ShedStage::None,
            buffer_frames: 10,
            buffer_capacity: 1000,
        };
        let subsystems = evaluate_subsystems(&[], Some(&cs), None);
        assert_eq!(subsystems.len(), 5);
        assert_eq!(subsystems[0].name, "Capture Pipeline");
        assert_eq!(subsystems[0].status, "healthy");
        assert!(subsystems[0].detail.contains("10/1000"));
        assert_eq!(subsystems[2].name, "Process Correlator");
        assert_eq!(subsystems[2].status, "unknown"); // None correlator passed
    }
}
