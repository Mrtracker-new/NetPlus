//! The Website Journey (docs/14): the reconstruction and narration of the
//! *complete* story behind loading a website — the flagship of NetPulse's
//! understanding-first thesis (docs/14 §1).
//!
//! A journey is the narrative projection of a **session** (docs/14 §3): the Flow
//! Engine already produced the session's directed causal graph (docs/06 §6);
//! this module turns that graph into a human story of recognizable stages
//! (Navigation → DNS → Connection → Encryption → Request → Fan-out → Completion,
//! docs/14 §4) and visualizes the CDN/organization fan-out (docs/14 §5).
//!
//! Two rules are strict (docs/14 §11):
//! - It **renders** causality, never re-infers it — the session graph is the one
//!   source of truth. If causality is wrong, fix `06`, not this renderer.
//! - Every stage points back at the exact flows/session it rests on
//!   (evidence-reference invariant, docs/02 §6.3), so a beginner's clean story is
//!   auditable to the byte for an expert.
//!
//! It is honest about limits (docs/14 §8): an encrypted-only load is narrated
//! from metadata; a load that never completed is marked as such, not fabricated.

use std::collections::BTreeMap;

use netpulse_core::net::{L4Proto, L7Proto};
use netpulse_core::{EvidenceRef, Flow, Host};

use crate::render::SessionView;

/// A recognizable stage of a page load (docs/14 §4). The ordering of the enum is
/// the natural causal order the journey reads in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum StageKind {
    /// "You asked to visit example.com" (docs/14 §4, attribution/trigger).
    Navigation,
    /// Name → IP (docs/14 §4, docs/07 §6.5).
    DnsResolution,
    /// TCP/QUIC setup (docs/14 §4, docs/06 §4).
    Connection,
    /// TLS/QUIC handshake (docs/14 §4, docs/07 §6.6).
    Encryption,
    /// HTTP request(s) (docs/14 §4, docs/07 §6.7–6.10).
    Request,
    /// Sub-resources from many hosts (docs/14 §4–§5, session graph).
    FanOut,
    /// Load finished — or honestly didn't (docs/14 §4, §8).
    Completion,
}

/// One narrated stage of the journey (docs/14 §4, §6). `narration` is the
/// beginner story; `detail` is the intermediate+ technical line (timings,
/// transport, versions), disclosed progressively (docs/14 §7). Every stage
/// carries the evidence it rests on (docs/02 §6.3).
#[derive(Debug, Clone, PartialEq)]
pub struct JourneyStage {
    pub kind: StageKind,
    pub title: String,
    pub narration: String,
    /// Depth-gated technical detail (docs/14 §7); shown at Intermediate and above.
    pub detail: Option<String>,
    pub evidence: Vec<EvidenceRef>,
}

/// One node of the CDN/organization fan-out (docs/14 §5): a server or org the
/// page talked to, labeled by *local* enrichment where available (docs/14 §5,
/// never a live lookup, docs/14 §11). Each node drills into its real flows.
#[derive(Debug, Clone, PartialEq)]
pub struct FanoutNode {
    /// Organization/CDN name if enriched, else the bare IP — honest either way.
    pub label: String,
    pub flows: usize,
    pub bytes: u64,
    pub evidence: Vec<EvidenceRef>,
}

/// The complete journey for one session (docs/14 §3): the ordered stages and the
/// fan-out. A projection of one session model — the same data as the flows and
/// packets, told as cause-and-effect over time (docs/14 §3).
#[derive(Debug, Clone, PartialEq)]
pub struct PageJourney {
    pub session_id: u64,
    pub stages: Vec<JourneyStage>,
    pub fanout: Vec<FanoutNode>,
}

/// Build a journey from a session view, without host enrichment (fan-out nodes
/// are labeled by IP). See [`build_page_journey_with_hosts`] for org labels.
pub fn build_page_journey(view: &SessionView) -> PageJourney {
    build_page_journey_with_hosts(view, &[])
}

/// Build a journey, labeling fan-out nodes by organization/CDN from local
/// enrichment where a matching [`Host`] is supplied (docs/14 §5). Never performs
/// a live lookup — labels come only from the passed-in local data (docs/14 §11).
pub fn build_page_journey_with_hosts(view: &SessionView, hosts: &[Host]) -> PageJourney {
    let host_name = triggering_host(&view.session.trigger);
    let mut stages = Vec::new();

    stages.push(navigation_stage(view, host_name.as_deref()));

    if let Some(stage) = dns_stage(view, host_name.as_deref()) {
        stages.push(stage);
    }
    if let Some(stage) = connection_stage(view) {
        stages.push(stage);
    }
    if let Some(stage) = encryption_stage(view, host_name.as_deref()) {
        stages.push(stage);
    }
    if let Some(stage) = request_stage(view) {
        stages.push(stage);
    }

    let fanout = build_fanout(&view.flows, hosts);
    if fanout.len() >= 2 {
        stages.push(fanout_stage(&fanout));
    }
    stages.push(completion_stage(view));

    PageJourney {
        session_id: view.session.id,
        stages,
        fanout,
    }
}

fn navigation_stage(view: &SessionView, host: Option<&str>) -> JourneyStage {
    let narration = match host {
        Some(name) => format!("You asked to visit {name}."),
        None => "You started some network activity.".to_string(),
    };
    JourneyStage {
        kind: StageKind::Navigation,
        title: "Navigation".into(),
        narration,
        detail: None,
        evidence: vec![EvidenceRef::Session(view.session.id)],
    }
}

fn dns_stage(view: &SessionView, host: Option<&str>) -> Option<JourneyStage> {
    // DNS is evidenced by a DNS event or by the session's resolution lineage —
    // the reconstructor only names a "resolved and connected to X" trigger on
    // DNS lineage (docs/06 §6.1), so that is itself honest proof (docs/14 §11).
    let dns_seen = view.session.trigger.contains("resolved")
        || view.events.iter().any(|e| {
            matches!(
                e.kind,
                netpulse_core::ProtoEventKind::DnsQuery
                    | netpulse_core::ProtoEventKind::DnsResponse
            )
        });
    if !dns_seen {
        return None;
    }
    let server = first_server(&view.flows);
    let narration = match (host, server) {
        (Some(name), Some(ip)) => format!("Your computer looked up {name} and got {ip}."),
        (Some(name), None) => format!("Your computer looked up {name}."),
        (None, Some(ip)) => format!("Your computer resolved a name to {ip}."),
        (None, None) => "Your computer resolved the site's address.".to_string(),
    };
    let detail = dns_setup_millis(view).map(|ms| format!("DNS resolved in {ms} ms"));
    Some(JourneyStage {
        kind: StageKind::DnsResolution,
        title: "DNS resolution".into(),
        narration,
        detail,
        evidence: vec![EvidenceRef::Session(view.session.id)],
    })
}

fn connection_stage(view: &SessionView) -> Option<JourneyStage> {
    let conn = view
        .flows
        .iter()
        .find(|f| !matches!(f.state, netpulse_core::FlowState::SynSeen))?;
    let transport = match conn.l4 {
        L4Proto::Tcp => "TCP",
        L4Proto::Udp => "UDP",
        _ => "an IP transport",
    };
    let detail = conn
        .stats
        .rtt_estimate_nanos
        .map(|ns| format!("Connection setup ~{} ms over {transport}", ns / 1_000_000));
    Some(JourneyStage {
        kind: StageKind::Connection,
        title: "Connection".into(),
        narration: "It opened a connection to a server.".into(),
        detail,
        evidence: vec![EvidenceRef::Flow(conn.id)],
    })
}

fn encryption_stage(view: &SessionView, host: Option<&str>) -> Option<JourneyStage> {
    let encrypted: Vec<&&Flow> = view
        .flows
        .iter()
        .filter(|f| matches!(f.l7, L7Proto::Tls | L7Proto::Http3 | L7Proto::Quic))
        .collect();
    let plaintext = view.flows.iter().any(|f| matches!(f.l7, L7Proto::Http1));

    if encrypted.is_empty() {
        // Honest: only narrate encryption when we actually saw it (docs/01 E3).
        if plaintext {
            return Some(JourneyStage {
                kind: StageKind::Encryption,
                title: "Encryption".into(),
                narration: "This connection was not encrypted — it used plain HTTP.".into(),
                detail: Some("No TLS handshake observed".into()),
                evidence: vec![EvidenceRef::Session(view.session.id)],
            });
        }
        return None;
    }

    let narration = match host {
        Some(name) => format!("It agreed on encryption with {name} (TLS)."),
        None => "It agreed on encryption (TLS).".to_string(),
    };
    Some(JourneyStage {
        kind: StageKind::Encryption,
        title: "Encryption".into(),
        narration,
        detail: Some("TLS handshake — certificate checked against a trusted authority".into()),
        evidence: encrypted.iter().map(|f| EvidenceRef::Flow(f.id)).collect(),
    })
}

fn request_stage(view: &SessionView) -> Option<JourneyStage> {
    let http_seen = view.events.iter().any(|e| {
        matches!(
            e.kind,
            netpulse_core::ProtoEventKind::HttpRequest
                | netpulse_core::ProtoEventKind::HttpResponse
        )
    });
    // Even fully-encrypted loads make a request; narrate it honestly from
    // metadata when we can't see the plaintext (docs/14 §8).
    let has_established = view.flows.iter().any(|f| {
        matches!(
            f.state,
            netpulse_core::FlowState::Established | netpulse_core::FlowState::Closed
        )
    });
    if !http_seen && !has_established {
        return None;
    }
    let detail = if http_seen {
        Some("HTTP request observed".to_string())
    } else {
        Some("Request contents encrypted; inferred from the connection".to_string())
    };
    Some(JourneyStage {
        kind: StageKind::Request,
        title: "Request".into(),
        narration: "It requested the page.".into(),
        detail,
        evidence: vec![EvidenceRef::Session(view.session.id)],
    })
}

fn fanout_stage(fanout: &[FanoutNode]) -> JourneyStage {
    let orgs = fanout.len();
    let servers: usize = fanout.iter().map(|n| n.flows).sum();
    let evidence: Vec<EvidenceRef> = fanout.iter().flat_map(|n| n.evidence.clone()).collect();
    JourneyStage {
        kind: StageKind::FanOut,
        title: "Fan-out".into(),
        narration: format!("The page pulled in resources from {orgs} different places."),
        detail: Some(format!(
            "{servers} connection(s) across {orgs} host(s)/org(s)"
        )),
        evidence,
    }
}

fn completion_stage(view: &SessionView) -> JourneyStage {
    let bytes: u64 = view.flows.iter().map(|f| f.stats.bytes).sum();
    let completed = view.flows.iter().any(|f| {
        matches!(
            f.state,
            netpulse_core::FlowState::Established
                | netpulse_core::FlowState::Closed
                | netpulse_core::FlowState::Closing
        )
    });
    let (narration, detail) = if completed {
        (
            "Everything arrived and the page finished loading.".to_string(),
            Some(format!("{bytes} bytes total")),
        )
    } else {
        // Honest about an incomplete/failed load (docs/14 §8) — never fabricated.
        (
            "The load did not complete — the connection was not established.".to_string(),
            Some("No established connection observed".to_string()),
        )
    };
    JourneyStage {
        kind: StageKind::Completion,
        title: "Completion".into(),
        narration,
        detail,
        evidence: vec![EvidenceRef::Session(view.session.id)],
    }
}

/// Group the session's flows into fan-out nodes (docs/14 §5), by organization
/// when a local [`Host`] enrichment supplies one, else by destination IP.
/// Deterministic order (by label) for reproducible journeys (docs/14 §10).
fn build_fanout(flows: &[&Flow], hosts: &[Host]) -> Vec<FanoutNode> {
    let mut by_label: BTreeMap<String, (usize, u64, Vec<EvidenceRef>)> = BTreeMap::new();
    for f in flows {
        let label = label_for(f.key.dst_ip, hosts);
        let entry = by_label.entry(label).or_insert((0, 0, Vec::new()));
        entry.0 += 1;
        entry.1 += f.stats.bytes;
        entry.2.push(EvidenceRef::Flow(f.id));
    }
    by_label
        .into_iter()
        .map(|(label, (flows, bytes, evidence))| FanoutNode {
            label,
            flows,
            bytes,
            evidence,
        })
        .collect()
}

/// The org/CDN label for a destination IP from local enrichment (docs/14 §5),
/// falling back to the bare IP. Never a live lookup (docs/14 §11).
fn label_for(ip: std::net::IpAddr, hosts: &[Host]) -> String {
    hosts
        .iter()
        .find(|h| h.ip == ip)
        .and_then(|h| h.org.clone())
        .unwrap_or_else(|| ip.to_string())
}

/// The first server IP among the flows, deterministically ordered.
fn first_server(flows: &[&Flow]) -> Option<std::net::IpAddr> {
    let mut ips: Vec<std::net::IpAddr> = flows.iter().map(|f| f.key.dst_ip).collect();
    ips.sort();
    ips.into_iter().next()
}

/// The DNS→connect setup delay in ms, when a lookup preceded a connection (the
/// same measure the narrative card uses, docs/09 §5.1).
fn dns_setup_millis(view: &SessionView) -> Option<u64> {
    let start = view.session.start_ts.mono_nanos;
    let first_conn = view
        .flows
        .iter()
        .map(|f| f.first_ts.mono_nanos)
        .filter(|&t| t >= start)
        .min()?;
    Some((first_conn - start) / 1_000_000)
}

/// Read the host name back out of the session trigger, one source of truth
/// (docs/14 §11) — mirrors the helper in `render.rs`.
fn triggering_host(trigger: &str) -> Option<String> {
    trigger
        .rsplit(" to ")
        .next()
        .filter(|s| !s.is_empty() && *s != trigger)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use netpulse_core::{
        FlowMetrics, FlowState, Host, ProtoEvent, ProtoEventKind, Session, Timestamp,
    };
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn flow(id: u64, dst: IpAddr, l7: L7Proto, start: u64, bytes: u64, state: FlowState) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(ip(192, 168, 0, 1), 50000, dst, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(start, start),
            last_ts: Timestamp::new(start + 1, start + 1),
            l4: L4Proto::Tcp,
            l7,
            stats: FlowMetrics {
                bytes,
                packets: 4,
                rtt_estimate_nanos: Some(30_000_000),
                retransmits: 0,
                loss_indicators: 0,
            },
            state,
        }
    }

    fn session(start: u64, flow_ids: Vec<u64>) -> Session {
        Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(start, start),
            trigger: "resolved and connected to example.com".into(),
            flow_ids,
        }
    }

    fn dns_event() -> ProtoEvent {
        ProtoEvent {
            flow_id: 10,
            ts: Timestamp::new(1_000, 1_000),
            kind: ProtoEventKind::DnsResponse,
        }
    }

    #[test]
    fn journey_stages_follow_causal_order() {
        let s = session(1_000, vec![10]);
        let f = flow(
            10,
            ip(93, 184, 216, 34),
            L7Proto::Tls,
            1_012_000_000,
            240 * 1024,
            FlowState::Closed,
        );
        let ev = dns_event();
        let view = SessionView::new(&s, vec![&f], vec![&ev]);
        let journey = build_page_journey(&view);

        let kinds: Vec<StageKind> = journey.stages.iter().map(|s| s.kind).collect();
        // Navigation → DNS → Connection → Encryption → Request → Completion.
        assert_eq!(kinds.first(), Some(&StageKind::Navigation));
        assert!(kinds.contains(&StageKind::DnsResolution));
        assert!(kinds.contains(&StageKind::Encryption));
        assert_eq!(kinds.last(), Some(&StageKind::Completion));
        // The navigation names the site in plain words.
        assert!(journey.stages[0].narration.contains("example.com"));
        // Every stage carries evidence (docs/02 §6.3).
        assert!(journey.stages.iter().all(|s| !s.evidence.is_empty()));
    }

    #[test]
    fn encrypted_only_journey_is_built_from_metadata() {
        // No HTTP event (encrypted), but a coherent journey still forms (docs/14 §8).
        let s = session(1_000, vec![10]);
        let f = flow(
            10,
            ip(93, 184, 216, 34),
            L7Proto::Tls,
            1_000,
            120 * 1024,
            FlowState::Established,
        );
        let view = SessionView::new(&s, vec![&f], vec![]);
        let journey = build_page_journey(&view);
        assert!(journey
            .stages
            .iter()
            .any(|st| st.kind == StageKind::Encryption));
        // The request stage is inferred honestly from the established connection.
        let req = journey
            .stages
            .iter()
            .find(|st| st.kind == StageKind::Request)
            .expect("request stage");
        assert!(req.detail.as_deref().unwrap().contains("encrypted"));
    }

    #[test]
    fn plaintext_load_is_not_called_encrypted() {
        let s = session(1_000, vec![10]);
        let f = flow(
            10,
            ip(1, 2, 3, 4),
            L7Proto::Http1,
            1_000,
            1024,
            FlowState::Closed,
        );
        let view = SessionView::new(&s, vec![&f], vec![]);
        let journey = build_page_journey(&view);
        let enc = journey
            .stages
            .iter()
            .find(|st| st.kind == StageKind::Encryption)
            .expect("encryption stage present, stated honestly");
        assert!(enc.narration.contains("not encrypted"));
    }

    #[test]
    fn fanout_groups_by_org_when_enriched() {
        let s = session(1_000, vec![10, 11, 12]);
        let f1 = flow(
            10,
            ip(1, 1, 1, 1),
            L7Proto::Tls,
            1_000,
            100,
            FlowState::Closed,
        );
        let f2 = flow(
            11,
            ip(1, 1, 1, 2),
            L7Proto::Tls,
            1_000,
            200,
            FlowState::Closed,
        );
        let f3 = flow(
            12,
            ip(8, 8, 4, 4),
            L7Proto::Tls,
            1_000,
            50,
            FlowState::Closed,
        );
        let view = SessionView::new(&s, vec![&f1, &f2, &f3], vec![]);
        let hosts = vec![
            Host {
                ip: ip(1, 1, 1, 1),
                names: vec![],
                geo: None,
                asn: None,
                org: Some("Cloudflare".into()),
            },
            Host {
                ip: ip(1, 1, 1, 2),
                names: vec![],
                geo: None,
                asn: None,
                org: Some("Cloudflare".into()),
            },
            Host {
                ip: ip(8, 8, 4, 4),
                names: vec![],
                geo: None,
                asn: None,
                org: Some("Google".into()),
            },
        ];
        let journey = build_page_journey_with_hosts(&view, &hosts);
        // Two orgs, not three IPs (docs/14 §5 groups by organization).
        assert_eq!(journey.fanout.len(), 2);
        let cf = journey
            .fanout
            .iter()
            .find(|n| n.label == "Cloudflare")
            .unwrap();
        assert_eq!(cf.flows, 2);
        assert_eq!(cf.bytes, 300);
        // The fan-out stage appears because >= 2 nodes were contacted.
        assert!(journey.stages.iter().any(|st| st.kind == StageKind::FanOut));
    }

    #[test]
    fn incomplete_load_is_marked_not_fabricated() {
        // Only a SynSeen flow — the connection never established (docs/14 §8).
        let s = session(1_000, vec![10]);
        let f = flow(
            10,
            ip(1, 2, 3, 4),
            L7Proto::Unknown,
            1_000,
            0,
            FlowState::SynSeen,
        );
        let view = SessionView::new(&s, vec![&f], vec![]);
        let journey = build_page_journey(&view);
        let done = journey
            .stages
            .iter()
            .find(|st| st.kind == StageKind::Completion)
            .unwrap();
        assert!(done.narration.contains("did not complete"));
    }
}
