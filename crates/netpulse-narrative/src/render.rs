//! The rule system that projects the reconstruction model into cards
//!Sentences are *generated* from the model here, not
//! free-written, and every one is backed by the flows/session it
//! describes.
//!
//! A [`SessionView`] bundles a [`Session`] with the [`Flow`]s it groups and
//! their [`ProtoEvent`]s, because narrative is a pure projection with no storage
//! dependency: the caller (the engine, over the query surface of
//!  gathers the pieces and hands them in.

use netpulse_core::net::L7Proto;
use netpulse_core::{EvidenceRef, Flow, Journey, ProtoEvent, ProtoEventKind, Session};

use crate::card::{NarrativeCard, Severity};

/// A session together with the flows it groups and their protocol events — the
/// input the card/journey rules need, gathered by the caller from storage
/// so this crate stays a pure projection.
#[derive(Debug, Clone)]
pub struct SessionView<'a> {
    pub session: &'a Session,
    pub flows: Vec<&'a Flow>,
    pub events: Vec<&'a ProtoEvent>,
}

impl<'a> SessionView<'a> {
    /// Bundle a session with its flows and their events.
    pub fn new(session: &'a Session, flows: Vec<&'a Flow>, events: Vec<&'a ProtoEvent>) -> Self {
        Self {
            session,
            flows,
            events,
        }
    }
}

/// Build one narrative card summarizing a session.
///
/// The card carries detail lines at increasing depths (protocol, DNS timing,
/// byte volume, server fan-out), so one card serves beginner through expert
///Provenance is the session plus every flow it groups, so a
/// drill-down can reach the exact evidence.
pub fn build_card(view: &SessionView) -> NarrativeCard {
    let s = view.session;
    let host = triggering_host(&s.trigger);

    // Provenance: the session and each of its flows.
    let mut evidence = Vec::with_capacity(1 + view.flows.len());
    evidence.push(EvidenceRef::Session(s.id));
    for f in &view.flows {
        evidence.push(EvidenceRef::Flow(f.id));
    }

    let headline = match &host {
        Some(name) => format!("Connected to {name}"),
        None => "Network activity".to_string(),
    };

    let mut card = NarrativeCard::new(headline, s.start_ts.mono_nanos, evidence);

    // Beginner line: security posture in plain words, only if we can back it up.
    if let Some(sec) = security_phrase(&view.flows) {
        card = card.line(netpulse_core::Depth::Beginner, sec);
    }

    // Intermediate line: DNS timing, if a lookup preceded a connection here.
    if let Some(ms) = dns_setup_millis(view) {
        card = card.line(
            netpulse_core::Depth::Intermediate,
            format!("DNS resolved in {ms} ms"),
        );
    }

    // Intermediate line: byte volume + server fan-out — the "how much / how many".
    let bytes: u64 = view.flows.iter().map(|f| f.stats.bytes).sum();
    let servers = distinct_servers(&view.flows);
    if bytes > 0 || servers > 0 {
        card = card.line(
            netpulse_core::Depth::Intermediate,
            format!(
                "{} from {} server{}",
                human_bytes(bytes),
                servers,
                if servers == 1 { "" } else { "s" }
            ),
        );
    }

    // Expert line: per-protocol landmark counts, precise and terse.
    if let Some(events) = event_breakdown(&view.events) {
        card = card.line(netpulse_core::Depth::Expert, events);
    }

    card.with_severity(Severity::Neutral)
}

/// Build cards for many sessions, feed-ordered newest-first.
pub fn build_cards(views: &[SessionView]) -> Vec<NarrativeCard> {
    let mut cards: Vec<NarrativeCard> = views.iter().map(build_card).collect();
    // Feed order: most recent first. A stable sort preserves input order for
    // equal timestamps, so the result is deterministic.
    cards.sort_by_key(|c| std::cmp::Reverse(c.at_mono_nanos));
    cards
}

/// Build the [`Journey`] projection of a session: the ordered
/// sentences of its story. Each sentence is generated from the model; the
/// journey shares the card's evidence discipline via [`build_card`].
pub fn build_journey(view: &SessionView) -> Journey {
    let card = build_card(view);
    // Expert depth for the journey: the journey view is the full story; the UI
    // still discloses progressively, but the sentences themselves are complete.
    Journey {
        session_id: view.session.id,
        sentences: card.render(netpulse_core::Depth::Expert),
    }
}

/// Extract the host name from a session trigger. The reconstructor writes
/// "resolved and connected to {name}"; we read the
/// name back rather than re-deriving it, keeping one source of truth.
fn triggering_host(trigger: &str) -> Option<String> {
    trigger
        .rsplit(" to ")
        .next()
        .filter(|s| !s.is_empty() && *s != trigger)
        .map(str::to_string)
}

/// A beginner-readable security phrase, only when the L7 evidence supports it.
/// We never claim "encrypted" without seeing an encrypted protocol (docs/01 E3:
/// simplifications may not lie).
fn security_phrase(flows: &[&Flow]) -> Option<String> {
    let encrypted = flows
        .iter()
        .any(|f| matches!(f.l7, L7Proto::Tls | L7Proto::Http3 | L7Proto::Quic));
    let plaintext = flows.iter().any(|f| matches!(f.l7, L7Proto::Http1));
    match (encrypted, plaintext) {
        (true, false) => Some("Encrypted".to_string()),
        (false, true) => Some("Not encrypted".to_string()),
        (true, true) => Some("Partly encrypted".to_string()),
        (false, false) => None,
    }
}

/// The setup delay in milliseconds between the session start (the DNS lookup
/// that seeded it) and the first connecting flow, when both are present.
fn dns_setup_millis(view: &SessionView) -> Option<u64> {
    let dns_seen = view.events.iter().any(|e| {
        matches!(
            e.kind,
            ProtoEventKind::DnsResponse | ProtoEventKind::DnsQuery
        )
    });
    if !dns_seen {
        return None;
    }
    let start = view.session.start_ts.mono_nanos;
    let first_conn = view
        .flows
        .iter()
        .map(|f| f.first_ts.mono_nanos)
        .filter(|&t| t >= start)
        .min()?;
    Some((first_conn - start) / 1_000_000)
}

/// Count distinct server IPs across the session's flows (the "from N servers").
fn distinct_servers(flows: &[&Flow]) -> usize {
    let mut ips: Vec<std::net::IpAddr> = flows.iter().map(|f| f.key.dst_ip).collect();
    ips.sort();
    ips.dedup();
    ips.len()
}

/// A terse per-kind protocol-event breakdown for the expert line, e.g.
/// "1 DNS query, 1 TLS handshake". `None` when there are no events to report.
fn event_breakdown(events: &[&ProtoEvent]) -> Option<String> {
    if events.is_empty() {
        return None;
    }
    let mut dns = 0u32;
    let mut tls = 0u32;
    let mut http = 0u32;
    let mut quic = 0u32;
    let mut other = 0u32;
    for e in events {
        match e.kind {
            ProtoEventKind::DnsQuery | ProtoEventKind::DnsResponse => dns += 1,
            ProtoEventKind::TlsClientHello | ProtoEventKind::TlsServerHello => tls += 1,
            ProtoEventKind::HttpRequest | ProtoEventKind::HttpResponse => http += 1,
            ProtoEventKind::QuicHandshakeComplete => quic += 1,
            // `Other` today, plus any future variant added to this
            // `#[non_exhaustive]` enum — counted honestly rather than dropped.
            ProtoEventKind::Other(_) => other += 1,
            _ => other += 1,
        }
    }
    let parts: Vec<String> = [
        (dns, "DNS"),
        (tls, "TLS"),
        (http, "HTTP"),
        (quic, "QUIC"),
        (other, "other"),
    ]
    .iter()
    .filter(|(n, _)| *n > 0)
    .map(|(n, label)| format!("{n} {label}"))
    .collect();
    if parts.is_empty() {
        None
    } else {
        Some(format!("events: {}", parts.join(", ")))
    }
}

/// Human-readable byte size (KB/MB , matching the card mockups.
fn human_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use netpulse_core::{Depth, FlowMetrics, FlowState, Timestamp};
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn tls_flow(id: u64, dst: IpAddr, start: u64, bytes: u64) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(ip(192, 168, 0, 1), 50000, dst, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(start, start),
            last_ts: Timestamp::new(start + 1, start + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes,
                packets: 4,
                rtt_estimate_nanos: Some(1),
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Established,
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

    fn dns_event(flow_id: u64, ts: u64) -> ProtoEvent {
        ProtoEvent {
            flow_id,
            ts: Timestamp::new(ts, ts),
            kind: ProtoEventKind::DnsResponse,
        }
    }

    #[test]
    fn card_names_host_and_carries_all_flow_evidence() {
        let s = session(1_000, vec![10, 11]);
        let f1 = tls_flow(10, ip(93, 184, 216, 34), 1_012_000_000, 200 * 1024);
        let f2 = tls_flow(11, ip(93, 184, 216, 35), 1_012_000_000, 40 * 1024);
        let view = SessionView::new(&s, vec![&f1, &f2], vec![]);
        let card = build_card(&view);

        assert_eq!(card.headline, "Connected to example.com");
        // Session + both flows are referenced.
        assert!(card.evidence().contains(&EvidenceRef::Session(1)));
        assert!(card.evidence().contains(&EvidenceRef::Flow(10)));
        assert!(card.evidence().contains(&EvidenceRef::Flow(11)));
    }

    #[test]
    fn beginner_card_is_terse_expert_is_dense() {
        let s = session(1_000, vec![10]);
        let f = tls_flow(10, ip(93, 184, 216, 34), 1_000 + 12_000_000, 240 * 1024);
        let ev = dns_event(10, 1_000);
        let view = SessionView::new(&s, vec![&f], vec![&ev]);
        let card = build_card(&view);

        let beginner = card.render(Depth::Beginner);
        let expert = card.render(Depth::Expert);
        assert!(beginner.len() < expert.len(), "expert discloses more");
        // Encrypted phrase is present for a TLS-only session.
        assert!(beginner.iter().any(|l| l == "Encrypted"));
        // DNS timing surfaces at intermediate+ and reflects the 12 ms gap.
        assert!(card
            .summary(Depth::Intermediate)
            .contains("DNS resolved in 12 ms"));
    }

    #[test]
    fn build_cards_orders_newest_first() {
        let old = session(1_000, vec![10]);
        let mut newer = session(9_000, vec![11]);
        newer.id = 2;
        let f1 = tls_flow(10, ip(1, 1, 1, 1), 1_000, 0);
        let f2 = tls_flow(11, ip(2, 2, 2, 2), 9_000, 0);
        let v_old = SessionView::new(&old, vec![&f1], vec![]);
        let v_new = SessionView::new(&newer, vec![&f2], vec![]);
        let cards = build_cards(&[v_old, v_new]);
        assert_eq!(cards[0].at_mono_nanos, 9_000, "newest first");
    }

    #[test]
    fn journey_projects_session_sentences() {
        let s = session(1_000, vec![10]);
        let f = tls_flow(10, ip(93, 184, 216, 34), 1_000, 1024);
        let view = SessionView::new(&s, vec![&f], vec![]);
        let journey = build_journey(&view);
        assert_eq!(journey.session_id, 1);
        assert!(journey.sentences[0].contains("example.com"));
    }

    #[test]
    fn plaintext_and_encrypted_phrasing_is_honest() {
        // A plaintext-only session must not be called "encrypted".
        let s = session(1_000, vec![10]);
        let mut f = tls_flow(10, ip(1, 2, 3, 4), 1_000, 0);
        f.l7 = L7Proto::Http1;
        let view = SessionView::new(&s, vec![&f], vec![]);
        let lines = build_card(&view).render(Depth::Beginner);
        assert!(lines.iter().any(|l| l == "Not encrypted"));
        assert!(!lines
            .iter()
            .any(|l| l.contains("Encrypted") && l != "Not encrypted"));
    }
}
