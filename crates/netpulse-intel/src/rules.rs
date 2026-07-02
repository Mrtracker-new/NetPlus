//! Rule/heuristic threat detectors (docs/18) — the recognisable *shapes* of
//! suspicious behaviour. Each obeys the detector contract (docs/18 §3): it cites
//! the exact flows/events that triggered it (docs/02 §6.3), produces calibrated
//! confidence rather than a verdict (docs/17 §5), and — the recurring discipline
//! — carries a benign explanation, because most of the time the behaviour is
//! innocent (the benign list lives on [`FindingKind`], docs/18 §3).
//!
//! These catch *known* patterns over the committed model; the anomaly engine
//! (docs/20, [`crate::anomaly`]) catches deviation-from-normal. Both feed one
//! finding framework (docs/17 §6), so the UI sees a consistent, comparable set.
//!
//! Every threshold is explicit and versioned in [`thresh`] (docs/18 §10 "prefer
//! baseline-relative signals over hardcoded thresholds" — where a baseline
//! exists it is used; the fixed floors here are conservative and honestly capped
//! in confidence, docs/18 §6).

use std::collections::BTreeMap;
use std::net::IpAddr;

use netpulse_core::{EvidenceRef, Flow, FlowState, ProtoEventKind};

use crate::finding::{FindingKind, SecurityFinding};
use crate::view::TrafficView;

/// Explicit, versioned detector thresholds (docs/18 §10). Nanoseconds for time.
mod thresh {
    /// Minimum flows to one host before a regular cadence looks like beaconing.
    pub const BEACON_MIN_FLOWS: usize = 4;
    /// Interval coefficient-of-variation at/under which cadence reads as "regular"
    /// (lower = more clock-like). 0.25 tolerates jitter but rejects bursty human
    /// browsing.
    pub const BEACON_MAX_CV: f64 = 0.25;

    /// Distinct ports on one host, in a short window, that look like a scan.
    pub const SCAN_MIN_PORTS: usize = 6;
    /// Window within which those port hits must fall to read as a scan (5 s).
    pub const SCAN_WINDOW_NANOS: u64 = 5_000_000_000;

    /// Flows to a single host beyond which the count itself looks like a storm.
    /// Set high because browsers legitimately fan out (docs/18 §4.8, §7).
    pub const STORM_MIN_FLOWS: usize = 20;

    /// DNS queries in the window beyond which the volume looks like a burst.
    pub const DNS_BURST_MIN: usize = 20;
}

/// Run the whole rule catalog over `view` and return every finding, unsorted and
/// un-corroborated (the assembler in [`crate::engine`] ranks and merges them).
pub fn detect_all(view: &TrafficView) -> Vec<SecurityFinding> {
    let mut out = Vec::new();
    out.extend(beaconing(view));
    out.extend(port_scan(view));
    out.extend(connection_storm(view));
    out.extend(unexpected_egress(view));
    out.extend(dns_anomaly(view));
    out
}

/// Group the view's flows by destination host IP, preserving a deterministic
/// order (docs/18 §8 indexed lookups; BTreeMap keeps output stable to test).
fn by_dst_host<'a>(view: &'a TrafficView) -> BTreeMap<IpAddr, Vec<&'a Flow>> {
    let mut map: BTreeMap<IpAddr, Vec<&Flow>> = BTreeMap::new();
    for f in view.flows {
        map.entry(f.key.dst_ip).or_default().push(f);
    }
    map
}

/// **Beaconing** (docs/18 §4.2): highly regular connections to one host at a
/// fixed interval — a classic C2 shape, and equally a classic *telemetry* shape,
/// so confidence stays measured and the benign case is always named.
pub fn beaconing(view: &TrafficView) -> Vec<SecurityFinding> {
    let mut out = Vec::new();
    for (host, flows) in by_dst_host(view) {
        if flows.len() < thresh::BEACON_MIN_FLOWS {
            continue;
        }
        let mut starts: Vec<u64> = flows.iter().map(|f| f.first_ts.mono_nanos).collect();
        starts.sort_unstable();
        let intervals: Vec<f64> = starts
            .windows(2)
            .map(|w| (w[1] - w[0]) as f64)
            .filter(|d| *d > 0.0)
            .collect();
        if intervals.len() < thresh::BEACON_MIN_FLOWS - 1 {
            continue;
        }
        let mean = intervals.iter().sum::<f64>() / intervals.len() as f64;
        if mean <= 0.0 {
            continue;
        }
        let var =
            intervals.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / intervals.len() as f64;
        let cv = var.sqrt() / mean;
        if cv > thresh::BEACON_MAX_CV {
            continue; // irregular — looks like human activity, not a beacon
        }

        // Confidence: more repetitions and a tighter cadence raise it; capped so
        // a beacon is never asserted as C2 (docs/01 X4). Telemetry looks identical.
        let regularity = (1.0 - cv / thresh::BEACON_MAX_CV) as f32; // 0..1
        let repetition = ((flows.len() - thresh::BEACON_MIN_FLOWS) as f32 / 8.0).min(1.0);
        let confidence = 0.45 + 0.15 * regularity + 0.15 * repetition;

        let secs = mean / 1e9;
        let explanation = format!(
            "This app connected to {host} {} times at a steady ~{secs:.0}s interval. Regular \
             check-ins like this are often background telemetry or update checks, but the same \
             shape can indicate beaconing — we can't tell which from here.",
            flows.len(),
        );
        let evidence: Vec<EvidenceRef> = flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
        if let Some(f) =
            SecurityFinding::observe(FindingKind::Beaconing, confidence, explanation, evidence)
        {
            out.push(f.with_technical(format!(
                "interval mean {secs:.2}s, cv {cv:.2} over {} samples",
                intervals.len()
            )));
        }
    }
    out
}

/// **Port scanning** (docs/18 §4.7): connections fanned across many ports of one
/// host in a short window. Failed (SYN-only) attempts raise confidence; a network
/// tool the user ran is the benign case. NetPulse *detects* scans, never performs
/// them (docs/17 §8).
pub fn port_scan(view: &TrafficView) -> Vec<SecurityFinding> {
    let mut out = Vec::new();
    for (host, flows) in by_dst_host(view) {
        // Distinct destination ports touched.
        let mut ports: Vec<u16> = flows.iter().map(|f| f.key.dst_port).collect();
        ports.sort_unstable();
        ports.dedup();
        if ports.len() < thresh::SCAN_MIN_PORTS {
            continue;
        }
        // Those hits must be clustered in a short window to read as a scan.
        let mut starts: Vec<u64> = flows.iter().map(|f| f.first_ts.mono_nanos).collect();
        starts.sort_unstable();
        let span = starts.last().unwrap() - starts.first().unwrap();
        if span > thresh::SCAN_WINDOW_NANOS {
            continue;
        }

        // Half-open / never-established attempts corroborate a scan (docs/18 §4.7).
        let failed = flows
            .iter()
            .filter(|f| matches!(f.state, FlowState::SynSeen))
            .count();
        let breadth = ((ports.len() - thresh::SCAN_MIN_PORTS) as f32 / 20.0).min(1.0);
        let failure = (failed as f32 / flows.len() as f32).min(1.0);
        let confidence = 0.4 + 0.2 * breadth + 0.2 * failure;

        let explanation = format!(
            "{} different ports on {host} were contacted within a few seconds. This can be \
             service discovery or a network tool you ran, but a fan across many ports is also \
             what a port scan looks like.",
            ports.len(),
        );
        let evidence: Vec<EvidenceRef> = flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
        if let Some(f) =
            SecurityFinding::observe(FindingKind::PortScan, confidence, explanation, evidence)
        {
            out.push(f.with_technical(format!(
                "{} distinct ports, {failed} half-open, span {:.1}s",
                ports.len(),
                span as f64 / 1e9
            )));
        }
    }
    out
}

/// **Connection storm** (docs/18 §4.8): an unusually large number of connections
/// to one host. Browsers and P2P legitimately fan out, so this is set high and
/// phrased tentatively; a category-aware baseline (docs/20) sharpens it later.
pub fn connection_storm(view: &TrafficView) -> Vec<SecurityFinding> {
    let mut out = Vec::new();
    for (host, flows) in by_dst_host(view) {
        if flows.len() < thresh::STORM_MIN_FLOWS {
            continue;
        }
        let over = ((flows.len() - thresh::STORM_MIN_FLOWS) as f32 / 40.0).min(1.0);
        let confidence = 0.35 + 0.2 * over;
        let explanation = format!(
            "{} separate connections to {host} in this window — more than usual for a single \
             host. Browsers and download managers open many connections legitimately, so this \
             is worth a glance rather than an alarm.",
            flows.len(),
        );
        let evidence: Vec<EvidenceRef> = flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
        if let Some(f) = SecurityFinding::observe(
            FindingKind::ConnectionStorm,
            confidence,
            explanation,
            evidence,
        ) {
            out.push(f);
        }
    }
    out
}

/// **Unexpected application Internet access** (docs/18 §4.1): a process reaching
/// the network, weighted by signing. An *unsigned* binary raises confidence; a
/// known publisher lowers it. Requires attribution — with none, we stay silent
/// rather than blame a flow on the wrong app (docs/12 §8).
pub fn unexpected_egress(view: &TrafficView) -> Vec<SecurityFinding> {
    // One finding per distinct unsigned process, aggregating its flows.
    let mut per_pid: BTreeMap<u64, (String, Vec<EvidenceRef>)> = BTreeMap::new();
    for f in view.flows {
        let Some(proc) = view.process(f.id) else {
            continue; // unattributed → no honest claim to make
        };
        if proc.signer.is_some() {
            continue; // signed by a known publisher → not notable on its own
        }
        let entry = per_pid
            .entry(proc.pid)
            .or_insert_with(|| (proc.name.clone(), Vec::new()));
        entry.1.push(EvidenceRef::Flow(f.id));
    }

    let mut out = Vec::new();
    for (pid, (name, evidence)) in per_pid {
        // Unsigned + reaching out. Confidence is modest: a new unsigned app is
        // very often benign (a fresh install, an updater), so this leans on
        // corroboration (docs/18 §5) to become notable.
        let explanation = format!(
            "\"{name}\" is not code-signed and was seen reaching the Internet. That's common for \
             a freshly installed app or a background service, but an unsigned program you don't \
             recognise is worth identifying before you trust it.",
        );
        if let Some(f) =
            SecurityFinding::observe(FindingKind::UnexpectedEgress, 0.4, explanation, evidence)
        {
            out.push(f.with_technical(format!("pid {pid}, unsigned binary")));
        }
    }
    out
}

/// **Suspicious DNS volume** (docs/18 §4.4): a burst of DNS queries far above the
/// usual rate. Entropy/DGA analysis needs query names the metadata model doesn't
/// carry yet, so this honest subset flags *volume* only and says so — noisy
/// heuristics stay tentative (docs/18 §4.4 edge, §6).
pub fn dns_anomaly(view: &TrafficView) -> Vec<SecurityFinding> {
    let mut dns_flow_ids: Vec<u64> = view
        .events
        .iter()
        .filter(|e| matches!(e.kind, ProtoEventKind::DnsQuery))
        .map(|e| e.flow_id)
        .collect();
    let count = dns_flow_ids.len();
    if count < thresh::DNS_BURST_MIN {
        return Vec::new();
    }
    dns_flow_ids.sort_unstable();
    dns_flow_ids.dedup();

    let over = ((count - thresh::DNS_BURST_MIN) as f32 / 40.0).min(1.0);
    let confidence = 0.35 + 0.15 * over; // capped low: volume alone is weak
    let explanation = format!(
        "{count} DNS lookups in this window — more than a typical page needs. This is usually a \
         site pulling resources from many domains or aggressive prefetch, but a lookup burst can \
         also accompany unusual activity. We can only see the volume here, not the names.",
    );
    let evidence: Vec<EvidenceRef> = dns_flow_ids
        .iter()
        .map(|id| EvidenceRef::Flow(*id))
        .collect();
    SecurityFinding::observe(FindingKind::DnsAnomaly, confidence, explanation, evidence)
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{FlowMetrics, FlowState, Process, ProtoEvent, Timestamp};
    use std::collections::HashMap;
    use std::net::Ipv4Addr;

    fn ip(d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(93, 184, 216, d))
    }

    fn flow_to(
        id: u64,
        dst: IpAddr,
        port: u16,
        start_ns: u64,
        state: FlowState,
        bytes: u64,
    ) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)),
                50000,
                dst,
                port,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(start_ns, start_ns),
            last_ts: Timestamp::new(start_ns + 1, start_ns + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes,
                packets: 4,
                rtt_estimate_nanos: None,
                retransmits: 0,
                loss_indicators: 0,
            },
            state,
        }
    }

    fn empty_procs() -> HashMap<u64, Process> {
        HashMap::new()
    }

    fn view<'a>(
        flows: &'a [Flow],
        events: &'a [ProtoEvent],
        procs: &'a HashMap<u64, Process>,
    ) -> TrafficView<'a> {
        TrafficView {
            flows,
            events,
            process_of: procs,
        }
    }

    #[test]
    fn regular_check_ins_read_as_beaconing() {
        // Five connections to one host, ~60s apart, tight cadence.
        let host = ip(34);
        let flows: Vec<Flow> = (0..5)
            .map(|i| flow_to(i, host, 443, i * 60_000_000_000, FlowState::Closed, 200))
            .collect();
        let procs = empty_procs();
        let f = beaconing(&view(&flows, &[], &procs));
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, FindingKind::Beaconing);
        // Names the benign telemetry reading and never asserts C2 (docs/18 §4.2).
        assert!(f[0].explanation.contains("telemetry"));
        assert!(f[0].confidence.value() < 1.0);
    }

    #[test]
    fn irregular_visits_are_not_beaconing() {
        // Human-ish jittery intervals → high CV → not flagged.
        let host = ip(34);
        let starts = [
            0u64,
            5_000_000_000,
            7_000_000_000,
            40_000_000_000,
            41_000_000_000,
        ];
        let flows: Vec<Flow> = starts
            .iter()
            .enumerate()
            .map(|(i, s)| flow_to(i as u64, host, 443, *s, FlowState::Closed, 200))
            .collect();
        let procs = empty_procs();
        assert!(beaconing(&view(&flows, &[], &procs)).is_empty());
    }

    #[test]
    fn many_ports_one_host_reads_as_scan() {
        let host = ip(34);
        let flows: Vec<Flow> = (0..8)
            .map(|i| {
                flow_to(
                    i,
                    host,
                    20 + i as u16,
                    i * 100_000_000,
                    FlowState::SynSeen,
                    0,
                )
            })
            .collect();
        let procs = empty_procs();
        let f = port_scan(&view(&flows, &[], &procs));
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, FindingKind::PortScan);
        assert_eq!(f[0].evidence.len(), 8);
    }

    #[test]
    fn unsigned_app_egress_needs_attribution() {
        let host = ip(34);
        let flows = vec![flow_to(1, host, 443, 0, FlowState::Closed, 100)];
        // No attribution → no claim (docs/12 §8).
        let empty = empty_procs();
        assert!(unexpected_egress(&view(&flows, &[], &empty)).is_empty());

        // With an unsigned process attributed → a modest finding.
        let mut procs = HashMap::new();
        procs.insert(
            1u64,
            Process {
                pid: 4242,
                name: "mystery.exe".into(),
                exe_path: "/tmp/mystery.exe".into(),
                signer: None,
                start_mono_nanos: 0,
            },
        );
        let f = unexpected_egress(&view(&flows, &[], &procs));
        assert_eq!(f.len(), 1);
        assert!(f[0].explanation.contains("mystery.exe"));

        // A signed app is not notable on its own.
        let mut signed = HashMap::new();
        signed.insert(
            1u64,
            Process {
                pid: 10,
                name: "chrome".into(),
                exe_path: "/usr/bin/chrome".into(),
                signer: Some("Google LLC".into()),
                start_mono_nanos: 0,
            },
        );
        assert!(unexpected_egress(&view(&flows, &[], &signed)).is_empty());
    }

    #[test]
    fn dns_burst_flags_only_on_volume() {
        let events: Vec<ProtoEvent> = (0..25)
            .map(|i| ProtoEvent {
                flow_id: i,
                ts: Timestamp::new(i, i),
                kind: ProtoEventKind::DnsQuery,
            })
            .collect();
        let procs = empty_procs();
        let f = dns_anomaly(&view(&[], &events, &procs));
        assert_eq!(f.len(), 1);
        assert!(f[0].explanation.contains("not the names"));
        // Below threshold → nothing.
        let few: Vec<ProtoEvent> = events.into_iter().take(5).collect();
        assert!(dns_anomaly(&view(&[], &few, &procs)).is_empty());
    }
}
