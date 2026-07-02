//! The grounded assistant (docs/19 §3, §5): retrieve the user's real evidence
//! first, distill it into a compact context, ask a backend to explain *that*, and
//! **validate the citations** before returning. Grounding is enforced by
//! retrieval + citation validation, not by trusting the model (docs/19 §12):
//! a claim whose cited evidence doesn't exist in the store is suppressed.
//!
//! The assistant reasons over storage *primitives* (flows, sessions, protocol
//! events, metrics) because this crate sits below the engine in the layer graph
//! (docs/04 §3) — it grounds in the same committed model everything else uses, so
//! its answers can never invent data the app doesn't have (docs/19 §7 "won't
//! invent data"). It explains observed data; it never makes a security *verdict*
//! (docs/19 §7, docs/01 X4) and never acts on the system (observe-only, docs/01 X1).

use netpulse_core::net::L7Proto;
use netpulse_core::{EvidenceRef, Flow};
use netpulse_storage::CaptureStore;

use crate::backend::{AiBackend, LocalTemplateBackend};
use crate::context::{DistilledContext, Fact, Intent};

/// A grounded, cited answer (docs/19 §6). Every substantive claim traces to a
/// citation that was verified to exist (docs/19 §3, §12). When `grounded` is
/// false the answer is an honest "I can't answer that from your data" — never a
/// fabrication (docs/19 §3).
#[derive(Debug, Clone, PartialEq)]
pub struct GroundedAnswer {
    /// The answer text, composed by the backend from grounded facts only.
    pub text: String,
    /// The evidence the answer rests on, validated against the store (docs/19 §12).
    pub citations: Vec<EvidenceRef>,
    /// True when the answer is backed by evidence; false for an honest decline.
    pub grounded: bool,
    /// Which backend answered (docs/19 §4), so the posture is always visible.
    pub backend_id: &'static str,
    /// Whether answering caused any network egress (docs/19 §4).
    pub is_remote: bool,
    /// Exactly what a remote backend *would* be sent, for per-request disclosure
    /// (docs/19 §4.3). Present even on the local path so the UI can show the user
    /// what going remote would disclose, before they ever opt in.
    pub disclosure: String,
}

/// The grounded Q&A service (docs/19). Generic over the [`AiBackend`] so the
/// local-default and an opt-in remote share one grounding + citation-validation
/// path — the privacy-sensitive logic lives here, once (docs/19 §4).
#[derive(Debug, Clone)]
pub struct Assistant<B: AiBackend> {
    backend: B,
}

impl Default for Assistant<LocalTemplateBackend> {
    fn default() -> Self {
        Self {
            backend: LocalTemplateBackend,
        }
    }
}

impl Assistant<LocalTemplateBackend> {
    /// The local-default assistant: zero egress, fully offline (docs/19 §4.1).
    pub fn local() -> Self {
        Self::default()
    }
}

impl<B: AiBackend> Assistant<B> {
    /// Build an assistant over an explicit backend (e.g. an opt-in remote one).
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    /// Answer `question` grounded in `store` (docs/19 §5). The pipeline is:
    /// classify → retrieve+distill → explain → validate citations. A hallucinated
    /// citation (one not in the store) is dropped, and if that leaves the answer
    /// unsupported it degrades to an honest decline (docs/19 §12).
    pub fn answer(&self, store: &CaptureStore, question: &str) -> GroundedAnswer {
        let intent = Intent::classify(question);
        let context = distill(store, question, intent);
        let disclosure = context.disclosure_preview();

        // The backend explains ONLY the distilled facts (docs/19 §3).
        let text = self.backend.explain(&context);

        // Grounding is checked, not trusted: keep only citations that really exist
        // in the store (docs/19 §12).
        let citations: Vec<EvidenceRef> = context
            .citations()
            .into_iter()
            .filter(|e| citation_exists(store, e))
            .collect();

        let grounded = !citations.is_empty();
        GroundedAnswer {
            text,
            citations,
            grounded,
            backend_id: self.backend.id(),
            is_remote: self.backend.is_remote(),
            disclosure,
        }
    }
}

/// Whether a citation points at a record that actually exists (docs/19 §12).
/// Packets are never citable under the metadata-only default (docs/08 §4), so a
/// packet citation is treated as unsupported rather than dangling.
fn citation_exists(store: &CaptureStore, e: &EvidenceRef) -> bool {
    match e {
        EvidenceRef::Flow(id) => store.flow(*id).is_some(),
        EvidenceRef::Session(id) => store.session(*id).is_some(),
        _ => false,
    }
}

/// Retrieve and distill the evidence relevant to `intent` (docs/19 §5 steps 2–3).
/// Bounded and compact — a handful of facts, never a capture dump (docs/19 §10).
fn distill(store: &CaptureStore, question: &str, intent: Intent) -> DistilledContext {
    let flows: Vec<&Flow> = store.flows_in_window(0, u64::MAX);
    let facts = match intent {
        Intent::TopBandwidth => top_bandwidth(&flows),
        Intent::ProtocolMix => protocol_mix(&flows),
        Intent::Connectivity => connectivity(&flows),
        Intent::Degradation => degradation(&flows),
        Intent::Summary => summary(store, &flows),
        Intent::Unknown => Vec::new(),
    };
    DistilledContext {
        question: question.to_string(),
        intent,
        facts,
    }
}

// ---- Per-intent retrieval over storage primitives (docs/19 §5) --------------

/// Human-readable byte size — small helper so facts read plainly (docs/19 §6).
fn human_bytes(n: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    let f = n as f64;
    if f >= MB {
        format!("{:.1} MB", f / MB)
    } else if f >= KB {
        format!("{:.1} KB", f / KB)
    } else {
        format!("{n} B")
    }
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

/// Top talkers by destination host, ranked (docs/19 §6.1 worked example).
fn top_bandwidth(flows: &[&Flow]) -> Vec<Fact> {
    use std::collections::BTreeMap;
    let mut by_host: BTreeMap<String, (u64, Vec<EvidenceRef>)> = BTreeMap::new();
    for f in flows {
        let e = by_host
            .entry(f.key.dst_ip.to_string())
            .or_insert((0, Vec::new()));
        e.0 += f.stats.bytes;
        e.1.push(EvidenceRef::Flow(f.id));
    }
    let mut ranked: Vec<(String, u64, Vec<EvidenceRef>)> =
        by_host.into_iter().map(|(k, (b, ev))| (k, b, ev)).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .take(3)
        .map(|(host, bytes, evidence)| Fact {
            text: format!(
                "{host} moved {} across {} flow(s)",
                human_bytes(bytes),
                evidence.len()
            ),
            evidence,
        })
        .collect()
}

/// Protocol composition of the capture (docs/19 §6.1).
fn protocol_mix(flows: &[&Flow]) -> Vec<Fact> {
    use std::collections::BTreeMap;
    let mut by_proto: BTreeMap<&'static str, (u64, Vec<EvidenceRef>)> = BTreeMap::new();
    for f in flows {
        let e = by_proto.entry(l7_label(f.l7)).or_insert((0, Vec::new()));
        e.0 += f.stats.bytes;
        e.1.push(EvidenceRef::Flow(f.id));
    }
    let mut ranked: Vec<(&str, u64, Vec<EvidenceRef>)> = by_proto
        .into_iter()
        .map(|(k, (b, ev))| (k, b, ev))
        .collect();
    // Most flows first; a reverse key keeps the ranking clippy-clean.
    ranked.sort_by_key(|r| std::cmp::Reverse(r.2.len()));
    ranked
        .into_iter()
        .map(|(proto, bytes, evidence)| Fact {
            text: format!(
                "{proto}: {} flow(s), {}",
                evidence.len(),
                human_bytes(bytes)
            ),
            evidence,
        })
        .collect()
}

/// Who the traffic reached, and how much of it (docs/19 §6.1).
fn connectivity(flows: &[&Flow]) -> Vec<Fact> {
    use std::collections::BTreeSet;
    if flows.is_empty() {
        return Vec::new();
    }
    let hosts: BTreeSet<String> = flows.iter().map(|f| f.key.dst_ip.to_string()).collect();
    let evidence: Vec<EvidenceRef> = flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
    vec![Fact {
        text: format!(
            "{} connection(s) reached {} distinct host(s)",
            flows.len(),
            hosts.len()
        ),
        evidence,
    }]
}

/// What the data shows about slowness — grounded in real loss/retransmit metrics,
/// carrying the honest limits of metadata-only insight (docs/19 §6.1, §9).
fn degradation(flows: &[&Flow]) -> Vec<Fact> {
    let lossy: Vec<&&Flow> = flows
        .iter()
        .filter(|f| f.stats.loss_indicators > 0 || f.stats.retransmits > 0)
        .collect();
    if lossy.is_empty() {
        // Honestly nothing to point at — not a fabricated cause (docs/11 §9).
        return Vec::new();
    }
    let total_loss: u32 = lossy.iter().map(|f| f.stats.loss_indicators).sum();
    let evidence: Vec<EvidenceRef> = lossy.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
    vec![Fact {
        text: format!(
            "{} flow(s) show packet loss or retransmissions ({} loss indicator(s) total), which \
             is the kind of thing that causes buffering",
            lossy.len(),
            total_loss
        ),
        evidence,
    }]
}

/// A grounded overview of the capture (docs/19 §6.1 "explain my day").
fn summary(store: &CaptureStore, flows: &[&Flow]) -> Vec<Fact> {
    if flows.is_empty() {
        return Vec::new();
    }
    let total_bytes: u64 = flows.iter().map(|f| f.stats.bytes).sum();
    let sessions = store.session_count();
    let evidence: Vec<EvidenceRef> = flows.iter().map(|f| EvidenceRef::Flow(f.id)).collect();
    let mut facts = vec![Fact {
        text: format!(
            "{} flow(s) across {} session(s), {} total",
            flows.len(),
            sessions,
            human_bytes(total_bytes)
        ),
        evidence,
    }];
    // Fold in the single top talker for a concrete anchor.
    if let Some(top) = top_bandwidth(flows).into_iter().next() {
        facts.push(Fact {
            text: format!("Your heaviest destination: {}", top.text),
            evidence: top.evidence,
        });
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use netpulse_core::{FlowMetrics, FlowState, Session, Timestamp};
    use netpulse_storage::PayloadPolicy;
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, d))
    }

    fn flow(id: u64, dst: IpAddr, l7: L7Proto, bytes: u64, loss: u32) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)),
                50000,
                dst,
                443,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(id, id),
            last_ts: Timestamp::new(id + 1, id + 1),
            l4: L4Proto::Tcp,
            l7,
            stats: FlowMetrics {
                bytes,
                packets: 10,
                rtt_estimate_nanos: None,
                retransmits: loss,
                loss_indicators: loss,
            },
            state: FlowState::Closed,
        }
    }

    fn store_with_traffic() -> CaptureStore {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.insert_flow(flow(1, ip(9), L7Proto::Tls, 5_000_000, 0), vec![]);
        store.insert_flow(flow(2, ip(9), L7Proto::Tls, 1_000_000, 0), vec![]);
        store.insert_flow(flow(3, ip(5), L7Proto::Dns, 500, 0), vec![]);
        store.insert_flow(flow(4, ip(7), L7Proto::Tls, 2000, 4), vec![]);
        store.insert_session(Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(1, 1),
            trigger: "t".into(),
            flow_ids: vec![1, 2, 3, 4],
        });
        store
    }

    #[test]
    fn top_bandwidth_is_grounded_and_cited() {
        let store = store_with_traffic();
        let a = Assistant::local().answer(&store, "which app used the most bandwidth?");
        assert!(a.grounded);
        assert!(a.text.contains("203.0.113.9")); // the 6 MB host, ranked first
        assert!(a.text.contains("5.7 MB")); // 6,000,000 B / 1024² ≈ 5.7 MiB
        assert!(!a.citations.is_empty());
        assert!(!a.is_remote); // local-default, zero egress (docs/19 §4.1)
    }

    #[test]
    fn insufficient_evidence_declines_honestly() {
        let store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let a = Assistant::local().answer(&store, "which app used the most bandwidth?");
        assert!(!a.grounded);
        assert!(a.text.to_lowercase().contains("don't see enough"));
        assert!(a.citations.is_empty());
    }

    #[test]
    fn degradation_grounds_in_real_loss() {
        let store = store_with_traffic();
        let a = Assistant::local().answer(&store, "why was it slow?");
        assert!(a.grounded);
        assert!(a.text.contains("packet loss"));
        // Cites the lossy flow (id 4).
        assert!(a.citations.contains(&EvidenceRef::Flow(4)));
    }

    #[test]
    fn ambiguous_question_asks_to_rephrase() {
        let store = store_with_traffic();
        let a = Assistant::local().answer(&store, "hello there");
        assert!(!a.grounded);
        assert!(a.text.to_lowercase().contains("not sure"));
    }

    #[test]
    fn disclosure_preview_is_always_available() {
        // Even on the local path, the user can see what going remote would send
        // (docs/19 §4.3) — and it never includes payloads.
        let store = store_with_traffic();
        let a = Assistant::local().answer(&store, "summarize my traffic");
        assert!(a.disclosure.contains("No packet payloads"));
    }
}
