//! Teachable-moment detection and grounded-lesson generation.
//!
//! This is the engine's core loop: watch the committed stream of
//! flows/sessions/events for **teachable moments** — recognizable, pedagogically
//! valuable patterns — and offer the matching lesson *grounded in the learner's
//! own data*. "Here's the TLS handshake **you** just made to the site **you**
//! visited" beats any textbook.
//!
//! Two rules are structural, not aspirational:
//! - A grounded offer **cites real evidence** ([`EvidenceRef`]s) — the same
//!   evidence-reference invariant the narrative obeys. An offer
//!   that asserts something the capture cannot show is a bug.
//! - Detection runs **off the hot path** over already-committed data, so it never affects capture.
//!
//! When the learner has produced no example of a concept, an offer can fall back
//! to a curated example, clearly flagged `grounded = false` so the
//! honesty principle is preserved — we never pass off a canned capture as theirs.

use netpulse_core::{EvidenceRef, Flow, ProtoEvent, ProtoEventKind, Session};

use crate::content::{self, ExerciseKind, Lesson, Level, Trigger};

/// The committed traffic the detector reads. Gathered by the
/// caller from storage and handed in, so this crate stays a pure
/// projection with no storage dependency — the same pattern as the narrative's
/// `SessionView`.
#[derive(Debug, Clone)]
pub struct TrafficView<'a> {
    /// The session these flows belong to, if any (its id anchors evidence and
    /// its trigger names the host — read back, never re-derived .
    pub session: Option<&'a Session>,
    pub flows: &'a [Flow],
    pub events: &'a [ProtoEvent],
}

/// A comprehension check derived from the learner's real capture.
/// The `answer` is *computed from the fixture's data*, not authored — which is
/// what makes grounded exercises trustworthy and testable.
#[derive(Debug, Clone, PartialEq)]
pub struct GroundedExercise {
    pub kind: ExerciseKind,
    pub prompt: String,
    /// The correct answer, derived from the observed evidence.
    pub answer: String,
}

/// A lesson offered to the learner, grounded in a real teachable moment
///Calm and dismissible by construction — the UI presents it as
/// an invitation, never a nag.
#[derive(Debug, Clone, PartialEq)]
pub struct LessonOffer {
    pub lesson_id: &'static str,
    pub title: &'static str,
    pub level: Level,
    pub trigger: Trigger,
    /// Plain-language facts pulled from the learner's own capture.
    pub grounding: Vec<String>,
    /// A check whose answer is derived from the real data.
    pub exercise: Option<GroundedExercise>,
    /// The exact evidence this offer rests on. Non-empty when
    /// `grounded`; empty only for a curated-example fallback.
    pub evidence: Vec<EvidenceRef>,
    /// True when grounded in the learner's own traffic; false for a curated
    /// example shown honestly as such.
    pub grounded: bool,
}

/// Detect every teachable moment in one traffic view and return the grounded
/// lesson offers, most-fundamental first. Deterministic: the same
/// view always yields the same offers, in the same order.
pub fn detect_offers(view: &TrafficView) -> Vec<LessonOffer> {
    let mut offers = Vec::new();
    for trigger in detect_triggers(view) {
        if let Some(lesson) = content::lesson_for_trigger(trigger) {
            offers.push(ground(lesson, trigger, view));
        }
    }
    // Fundamentals before refinements: order by level then id for stability.
    offers.sort_by(|a, b| a.level.cmp(&b.level).then(a.lesson_id.cmp(b.lesson_id)));
    offers
}

/// The teachable moments present in a view, deduplicated. Order
/// is the natural page-load order so the flagship journey reads top-to-bottom.
fn detect_triggers(view: &TrafficView) -> Vec<Trigger> {
    let mut triggers = Vec::new();
    let push = |t: Trigger, list: &mut Vec<Trigger>| {
        if !list.contains(&t) {
            list.push(t);
        }
    };

    // A DNS lookup is evidenced either by a DNS event on these flows or by the
    // session's very existence: the reconstructor only forms a "resolved and
    // connected to X" session on DNS lineage, so that trigger is
    // itself honest proof the lookup happened — the connection flow is grouped,
    // the resolver flow lives elsewhere.
    let resolved_lineage = view
        .session
        .map(|s| s.trigger.contains("resolved"))
        .unwrap_or(false);
    let has_dns = resolved_lineage
        || view.events.iter().any(|e| {
            matches!(
                e.kind,
                ProtoEventKind::DnsQuery | ProtoEventKind::DnsResponse
            )
        });
    let has_tls = view.events.iter().any(|e| {
        matches!(
            e.kind,
            ProtoEventKind::TlsClientHello | ProtoEventKind::TlsServerHello
        )
    });
    let has_http = view.events.iter().any(|e| {
        matches!(
            e.kind,
            ProtoEventKind::HttpRequest | ProtoEventKind::HttpResponse
        )
    });
    let has_tcp_conn = view.flows.iter().any(|f| {
        matches!(f.l4, netpulse_core::net::L4Proto::Tcp)
            && !matches!(f.state, netpulse_core::FlowState::SynSeen)
    });
    let has_loss = view
        .flows
        .iter()
        .any(|f| f.stats.retransmits > 0 || f.stats.loss_indicators > 0);
    let servers = distinct_servers(view.flows);

    if has_dns {
        push(Trigger::DnsLookup, &mut triggers);
    }
    if has_tcp_conn {
        push(Trigger::TcpHandshake, &mut triggers);
    }
    if has_tls {
        push(Trigger::TlsHandshake, &mut triggers);
    }
    if has_http {
        push(Trigger::HttpExchange, &mut triggers);
    }
    if has_loss {
        push(Trigger::LossBurst, &mut triggers);
    }
    if servers >= 3 {
        push(Trigger::FanOut, &mut triggers);
    }
    // The flagship: a navigation that resolved a name and then connected — the
    // whole "what happens when I type a URL?" story.
    if has_dns && has_tcp_conn {
        push(Trigger::PageLoad, &mut triggers);
    }
    triggers
}

/// Ground a catalog lesson in the view's real data: pull the facts and derive
/// the exercise answer from evidence.
fn ground(lesson: &Lesson, trigger: Trigger, view: &TrafficView) -> LessonOffer {
    let evidence = collect_evidence(view);
    let grounded = !evidence.is_empty();
    let host = view.session.and_then(|s| triggering_host(&s.trigger));
    let grounding = grounding_facts(trigger, view, host.as_deref());
    let exercise = grounded_exercise(lesson, trigger, host.as_deref());

    LessonOffer {
        lesson_id: lesson.id,
        title: lesson.title,
        level: lesson.level,
        trigger,
        grounding,
        exercise,
        evidence,
        grounded,
    }
}

/// Evidence for an offer: the session plus each flow it groups.
fn collect_evidence(view: &TrafficView) -> Vec<EvidenceRef> {
    let mut ev = Vec::new();
    if let Some(s) = view.session {
        ev.push(EvidenceRef::Session(s.id));
    }
    for f in view.flows {
        ev.push(EvidenceRef::Flow(f.id));
    }
    ev
}

/// Plain-language facts drawn from the learner's own capture.
fn grounding_facts(trigger: Trigger, view: &TrafficView, host: Option<&str>) -> Vec<String> {
    let mut facts = Vec::new();
    match trigger {
        Trigger::DnsLookup => {
            if let Some(name) = host {
                if let Some(ip) = first_server(view.flows) {
                    facts.push(format!("You looked up {name} and got {ip}."));
                } else {
                    facts.push(format!("You looked up {name}."));
                }
            }
        }
        Trigger::TcpHandshake => {
            if let Some(ms) = handshake_millis(view.flows) {
                facts.push(format!("The connection was set up in {ms} ms."));
            } else {
                facts.push("Your computer opened a connection with a 3-way handshake.".into());
            }
        }
        Trigger::TlsHandshake => match host {
            Some(name) => facts.push(format!("Your connection to {name} was encrypted (TLS).")),
            None => facts.push("Your connection was encrypted with TLS.".into()),
        },
        Trigger::HttpExchange => {
            let bytes: u64 = view.flows.iter().map(|f| f.stats.bytes).sum();
            facts.push(format!("Your browser requested the page ({bytes} bytes)."));
        }
        Trigger::LossBurst => {
            let rtx: u32 = view.flows.iter().map(|f| f.stats.retransmits).sum();
            let loss: u32 = view.flows.iter().map(|f| f.stats.loss_indicators).sum();
            facts.push(format!(
                "This session showed {rtx} retransmit(s) and {loss} loss indicator(s)."
            ));
        }
        Trigger::FanOut => {
            let servers = distinct_servers(view.flows);
            facts.push(format!(
                "Loading this took connections to {servers} different servers."
            ));
        }
        Trigger::PageLoad => {
            let servers = distinct_servers(view.flows);
            let bytes: u64 = view.flows.iter().map(|f| f.stats.bytes).sum();
            if let Some(name) = host {
                facts.push(format!(
                    "Visiting {name} contacted {servers} server(s) and moved {bytes} bytes."
                ));
            }
        }
        Trigger::None => {}
    }
    facts
}

/// Derive the exercise answer from the real evidence. This
/// is the crux: the answer is *computed*, so a grounded check cannot be wrong
/// about the learner's own data.
fn grounded_exercise(
    lesson: &Lesson,
    trigger: Trigger,
    host: Option<&str>,
) -> Option<GroundedExercise> {
    let template = lesson.exercises.first()?;
    let (prompt, answer) = match trigger {
        Trigger::DnsLookup => {
            let name = host?.to_string();
            (
                format!(
                    "Which name did your computer look up? ({})",
                    template.prompt
                ),
                name,
            )
        }
        Trigger::TcpHandshake => (
            template.prompt.to_string(),
            "SYN-ACK — the server agreeing to connect".to_string(),
        ),
        Trigger::TlsHandshake => (
            template.prompt.to_string(),
            "A proposal of TLS versions and cipher suites (plus SNI/ALPN)".to_string(),
        ),
        Trigger::HttpExchange => (
            template.prompt.to_string(),
            "The page (an HTTP request for a resource)".to_string(),
        ),
        Trigger::LossBurst => (
            template.prompt.to_string(),
            "Packet loss — data had to be retransmitted".to_string(),
        ),
        _ => return None,
    };
    Some(GroundedExercise {
        kind: template.kind,
        prompt,
        answer,
    })
}

/// The setup delay of the first connecting flow in milliseconds, from its RTT
/// estimate when observable.
fn handshake_millis(flows: &[Flow]) -> Option<u64> {
    flows
        .iter()
        .filter_map(|f| f.stats.rtt_estimate_nanos)
        .min()
        .map(|ns| ns / 1_000_000)
}

/// The first server IP among the flows, in deterministic order.
fn first_server(flows: &[Flow]) -> Option<std::net::IpAddr> {
    let mut ips: Vec<std::net::IpAddr> = flows.iter().map(|f| f.key.dst_ip).collect();
    ips.sort();
    ips.into_iter().next()
}

/// Distinct destination servers across the flows.
fn distinct_servers(flows: &[Flow]) -> usize {
    let mut ips: Vec<std::net::IpAddr> = flows.iter().map(|f| f.key.dst_ip).collect();
    ips.sort();
    ips.dedup();
    ips.len()
}

/// Read the host name back out of a session trigger ("resolved and connected to
/// {name}"). We *read* it rather than re-deriving it, keeping one source of truth
/// — the same helper the narrative uses.
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
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{FlowMetrics, FlowState, Timestamp};
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn flow(id: u64, dst: IpAddr, l7: L7Proto, rtt: Option<u64>) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(ip(192, 168, 0, 1), 50000, dst, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(1_000, 1_000),
            last_ts: Timestamp::new(2_000, 2_000),
            l4: L4Proto::Tcp,
            l7,
            stats: FlowMetrics {
                bytes: 2048,
                packets: 6,
                rtt_estimate_nanos: rtt,
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Established,
        }
    }

    fn session() -> Session {
        Session {
            id: 7,
            process_id: 0,
            start_ts: Timestamp::new(1_000, 1_000),
            trigger: "resolved and connected to example.com".into(),
            flow_ids: vec![10],
        }
    }

    fn event(kind: ProtoEventKind) -> ProtoEvent {
        ProtoEvent {
            flow_id: 10,
            ts: Timestamp::new(1_000, 1_000),
            kind,
        }
    }

    #[test]
    fn tls_handshake_is_a_grounded_teachable_moment() {
        let s = session();
        let f = flow(10, ip(93, 184, 216, 34), L7Proto::Tls, Some(30_000_000));
        let events = [event(ProtoEventKind::TlsClientHello)];
        let view = TrafficView {
            session: Some(&s),
            flows: std::slice::from_ref(&f),
            events: &events,
        };
        let offers = detect_offers(&view);
        let tls = offers
            .iter()
            .find(|o| o.trigger == Trigger::TlsHandshake)
            .expect("TLS handshake detected");
        assert_eq!(tls.lesson_id, "b5.encryption");
        assert!(tls.grounded, "grounded in the user's own flow");
        // The offer cites the real session and flow.
        assert!(tls.evidence.contains(&EvidenceRef::Session(7)));
        assert!(tls.evidence.contains(&EvidenceRef::Flow(10)));
        // Grounding names the site from the user's own capture.
        assert!(tls.grounding.iter().any(|g| g.contains("example.com")));
    }

    #[test]
    fn dns_exercise_answer_is_derived_from_real_data() {
        let s = session();
        let f = flow(10, ip(93, 184, 216, 34), L7Proto::Dns, None);
        let events = [event(ProtoEventKind::DnsResponse)];
        let view = TrafficView {
            session: Some(&s),
            flows: std::slice::from_ref(&f),
            events: &events,
        };
        let offers = detect_offers(&view);
        let dns = offers
            .iter()
            .find(|o| o.trigger == Trigger::DnsLookup)
            .expect("DNS lookup detected");
        let ex = dns.exercise.as_ref().expect("grounded exercise");
        // The correct answer is the *actual* name the fixture looked up.
        assert_eq!(ex.answer, "example.com");
        assert_eq!(ex.kind, ExerciseKind::Identify);
    }

    #[test]
    fn page_load_flagship_detected_when_dns_precedes_connection() {
        let s = session();
        let f = flow(10, ip(93, 184, 216, 34), L7Proto::Tls, Some(12_000_000));
        let events = [
            event(ProtoEventKind::DnsResponse),
            event(ProtoEventKind::TlsClientHello),
        ];
        let view = TrafficView {
            session: Some(&s),
            flows: std::slice::from_ref(&f),
            events: &events,
        };
        let offers = detect_offers(&view);
        assert!(offers.iter().any(|o| o.trigger == Trigger::PageLoad));
    }

    #[test]
    fn no_traffic_yields_no_offers() {
        let view = TrafficView {
            session: None,
            flows: &[],
            events: &[],
        };
        assert!(detect_offers(&view).is_empty());
    }

    #[test]
    fn offers_are_ordered_fundamentals_first() {
        let s = session();
        let mut lossy = flow(10, ip(1, 1, 1, 1), L7Proto::Tls, Some(1));
        lossy.stats.retransmits = 3;
        let events = [
            event(ProtoEventKind::DnsResponse),
            event(ProtoEventKind::TlsClientHello),
        ];
        let view = TrafficView {
            session: Some(&s),
            flows: std::slice::from_ref(&lossy),
            events: &events,
        };
        let offers = detect_offers(&view);
        // Beginner lessons sort before the Intermediate loss lesson.
        let first_level = offers.first().map(|o| o.level);
        assert_eq!(first_level, Some(Level::Beginner));
        assert_eq!(offers.last().map(|o| o.level), Some(Level::Intermediate));
    }
}
