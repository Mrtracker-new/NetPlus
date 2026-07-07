//! Monitoring — usage breakdowns and the "why is it slow?" diagnostics
//! (docs/11). This is the presentation-side analysis layer: it *projects* the
//! flow metrics the engine already computed (docs/06 §5) into the standing
//! answers users want — "how much / to where?" and "why is it bad?" — never
//! re-scanning packets (docs/11 §10).
//!
//! It lives in the engine because it is a read-only aggregation over the
//! committed reconstruction model (docs/11 §14: "consumes metrics from 06 and
//! time-series from 08"); it holds no capture or storage logic of its own.
//!
//! Two honesty rules from docs/11 are load-bearing here:
//! - **Diagnoses are hypotheses, not verdicts** (docs/11 §6.3): every
//!   [`Diagnosis`] carries a [`Confidence`] and the evidence it rests on, and is
//!   phrased "looks like", never asserted as certain.
//! - **Capture loss is not network loss** (docs/11 §6.4): the two are tracked in
//!   distinct fields and never summed. Presenting our own dropped packets as the
//!   network's loss would be both a correctness bug and a lie.

use std::collections::{BTreeMap, HashMap};
use std::net::IpAddr;

use netpulse_core::net::L7Proto;
use netpulse_core::{Confidence, EvidenceRef, Flow, HostName};

/// The passively-observed `IP → names` map the host breakdown joins against
/// (docs/08 §5). Owned by the store; borrowed here read-only for the join.
pub type NameMap = HashMap<IpAddr, Vec<HostName>>;

/// A ranked usage breakdown along one dimension (docs/11 §5): protocol, host,
/// or interface. Rows are ordered by bytes descending, ties by label, so the
/// "top talkers" are deterministic and stable to render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Breakdown {
    pub dimension: Dimension,
    pub rows: Vec<BreakdownRow>,
}

/// The dimension a [`Breakdown`] decomposes traffic along (docs/11 §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Dimension {
    Protocol,
    Host,
    Interface,
}

/// One row of a usage breakdown: a label, its byte and flow totals, and the
/// flows that back it so a click drills into them (docs/11 §5, continuous zoom).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreakdownRow {
    pub label: String,
    pub bytes: u64,
    pub flows: u32,
    /// Passively-observed names for this row's endpoint, empty when none were
    /// seen or the dimension has no IP (protocol/interface). The `label` stays the
    /// raw IP — the authoritative key — and these enrich it for display; a name is
    /// never substituted *for* the address (docs/08 §5, docs/02 §10.3).
    pub hostnames: Vec<HostName>,
    /// The flows this row aggregates — the drill-down target (docs/09 §8).
    pub evidence: Vec<EvidenceRef>,
}

/// Decompose a set of flows by application protocol (docs/11 §5, "by protocol").
pub fn breakdown_by_protocol(flows: &[&Flow]) -> Breakdown {
    aggregate(Dimension::Protocol, flows, |f| l7_label(f.l7).to_string())
}

/// Decompose by destination host IP (docs/11 §5, "by host"), joining in the
/// passively-observed names for each IP (docs/08 §5). The label stays the raw IP
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

/// Decompose by capture interface (docs/11 §5, "by interface incl. VPN").
/// The [`Flow`] model carries no interface id yet (it is a per-packet field,
/// docs/02 §6.1); until it is threaded through, everything attributes to one
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
/// (docs/11 §6.1). Each is a *hypothesis*, surfaced with confidence + evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Cause {
    /// Loss/jitter across many hosts at once → likely the local link
    /// (docs/11 §6.2).
    LocalWifi,
    /// High RTT to one host but not others → likely that server/path
    /// (docs/11 §6.2).
    DistantServer,
    /// A long gap before any connection starts → likely DNS (docs/11 §6.2).
    SlowDns,
    /// Loss that climbs as throughput rises → likely congestion (docs/11 §6.2).
    Congestion,
}

impl Cause {
    /// A plain-language, "looks like" phrasing — never a verdict (docs/11 §6.3).
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

/// A degradation diagnosis (docs/11 §6): a likely cause, a calibrated
/// confidence, and the flows that justify it. Constructed only by
/// [`diagnose`], so a diagnosis can never exist without its evidence
/// (docs/02 §6.3, docs/11 §12).
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnosis {
    pub cause: Cause,
    pub confidence: Confidence,
    pub evidence: Vec<EvidenceRef>,
    /// The "looks like …" explanation, ready to show (docs/11 §6.3).
    pub explanation: String,
}

/// Capture-vs-network loss, kept strictly separate (docs/11 §6.4). Summing
/// these would misreport our own dropped packets as the network's loss.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LossAccounting {
    /// Packets the *network* lost, inferred from flow metrics (docs/06 §5).
    pub network_loss_indicators: u32,
    /// Frames *NetPulse* dropped under load (docs/05 §9) — never network loss.
    pub capture_drops: u64,
}

/// Thresholds for the heuristic classifier (docs/11 §12: each rule is explicit
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
/// (docs/11 §6). Returns every cause whose evidence is present, most-confident
/// first. An empty result means "nothing looks wrong" — the honest default,
/// never a fabricated problem (docs/11 §9, idle state).
///
/// `dns_setup_gap_nanos` is the observed pause before the first connection in
/// the window, when a DNS lookup preceded it (docs/11 §6.2); `None` when there
/// was no such gap to measure.
pub fn diagnose(
    flows: &[&Flow],
    loss: LossAccounting,
    dns_setup_gap_nanos: Option<u64>,
) -> Vec<Diagnosis> {
    let mut out = Vec::new();

    // --- Slow DNS: a long gap before any connection started (docs/11 §6.2) ---
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

/// A monitoring snapshot over a window (docs/11 §5, §7): the usage breakdowns
/// plus any degradation diagnoses, ready to hand to the UI as one bundle.
#[derive(Debug, Clone)]
pub struct MonitorSnapshot {
    pub by_protocol: Breakdown,
    pub by_host: Breakdown,
    pub diagnoses: Vec<Diagnosis>,
    pub loss: LossAccounting,
}

/// Build a full monitoring snapshot from a window's flows and loss split.
pub fn snapshot(
    flows: &[&Flow],
    loss: LossAccounting,
    dns_setup_gap_nanos: Option<u64>,
    names: &NameMap,
) -> MonitorSnapshot {
    MonitorSnapshot {
        by_protocol: breakdown_by_protocol(flows),
        by_host: breakdown_by_host(flows, names),
        diagnoses: diagnose(flows, loss, dns_setup_gap_nanos),
        loss,
    }
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
        // Diagnosis points at the slow flow specifically (docs/02 §6.3).
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
        // Fast, lossless flows → nothing looks wrong (docs/11 §9). No fabrication.
        let f1 = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 1000, Some(20_000_000), 0);
        let f2 = flow(2, ip(2, 2, 2, 2), L7Proto::Tls, 1000, Some(18_000_000), 0);
        assert!(diagnose(&[&f1, &f2], LossAccounting::default(), None).is_empty());
    }

    #[test]
    fn capture_loss_is_not_summed_into_network_loss() {
        // The two loss kinds live in separate fields; nothing here adds them
        // (docs/11 §6.4). A snapshot preserves both distinctly.
        let f = flow(1, ip(1, 1, 1, 1), L7Proto::Tls, 1000, Some(20_000_000), 0);
        let loss = LossAccounting {
            network_loss_indicators: 0,
            capture_drops: 42,
        };
        let snap = snapshot(&[&f], loss, None, &NameMap::new());
        assert_eq!(snap.loss.capture_drops, 42);
        assert_eq!(snap.loss.network_loss_indicators, 0);
        // Capture drops alone never manufacture a network diagnosis.
        assert!(snap.diagnoses.is_empty());
    }
}
