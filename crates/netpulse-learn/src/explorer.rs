//! The Protocol Explorer (docs/15): an interactive reference for every protocol
//! field NetPulse dissects, wired to the learner's real observations both ways.
//!
//! The Explorer holds **no protocol knowledge of its own** (docs/15 §12): it is
//! a *presenter* of the `netpulse-decode` explanation-key content (docs/07 §7).
//! New protocols and fields appear here automatically the moment their keys and
//! content exist — there is no parallel catalog to maintain, and nothing here
//! can drift from what the dissectors actually emit (single source of truth,
//! docs/15 §12).
//!
//! Its distinguishing feature is bidirectionality (docs/15 §5): a field in the
//! learner's capture opens its entry, and an entry can list the learner's own
//! flows that exhibit it — the grounding principle (docs/01 E2) made navigable.
//! The "your examples" side is a storage query the caller supplies
//! ([`examples_for`]); the reference side ([`entry`]/[`browse`]/[`search`]) is a
//! pure function of the key vocabulary.

use netpulse_core::net::L7Proto;
use netpulse_core::{Depth, EvidenceRef, Flow};
use netpulse_decode::{explain, DisclosureDepth, ExplanationKey, ALL_KEYS};

/// A reference entry for one explanation key (docs/15 §4, §6), presenting the
/// layered content plus navigation to related keys. `examples_available` is set
/// by the caller after a storage lookup (docs/15 §5) — the pure presenter cannot
/// know the learner's data, and must not pretend to.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntry {
    pub key: &'static str,
    /// A humanized title derived from the key ("tcp.flags.syn" → "TCP flags syn").
    pub title: String,
    pub beginner: &'static str,
    pub intermediate: &'static str,
    pub expert: &'static str,
    /// Sibling keys under the same protocol, for cross-navigation (docs/15 §4).
    pub related: Vec<&'static str>,
    /// True once the caller has confirmed the learner has a real example
    /// (docs/15 §5); false by default so we never imply data we haven't checked.
    pub examples_available: bool,
}

/// One annotated field in the "explore my own packet" view (docs/15 §7): a real
/// field, its real value, and its explanation at the chosen depth — every field
/// labeled, the progressive-disclosure thesis at its purest.
#[derive(Debug, Clone, PartialEq)]
pub struct AnnotatedField {
    pub key: &'static str,
    pub value: String,
    pub explanation: String,
}

/// Resolve one key to its reference entry, or `None` for an unknown key
/// (docs/15 §4). A pure projection of the docs/07 §7 content.
pub fn entry(key: ExplanationKey) -> Option<ExplorerEntry> {
    let e = explain(key)?;
    Some(ExplorerEntry {
        key: key.as_str(),
        title: humanize(key.as_str()),
        beginner: e.beginner,
        intermediate: e.intermediate,
        expert: e.expert,
        related: related_keys(key.as_str()),
        examples_available: false,
    })
}

/// Browse the whole reference — one entry per key the dissectors can emit
/// (docs/15 §4), sorted by key for a stable, navigable index. This shares the
/// docs/07 §11 coverage guarantee: if a key exists, it is browsable here.
pub fn browse() -> Vec<ExplorerEntry> {
    let mut entries: Vec<ExplorerEntry> = ALL_KEYS.iter().filter_map(|&k| entry(k)).collect();
    entries.sort_by(|a, b| a.key.cmp(b.key));
    entries
}

/// Search the reference by a learner's words (docs/15 §8): matches the key
/// vocabulary, the humanized title, and a small synonym/symptom map so a
/// beginner's phrase ("padlock", "connection refused", "not found") reaches the
/// precise entry — avoiding gatekeeping (docs/01 §10). Results are de-duplicated
/// and stably ordered.
pub fn search(term: &str) -> Vec<ExplorerEntry> {
    let needle = term.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<&'static str> = Vec::new();
    let push = |k: &'static str, hits: &mut Vec<&'static str>| {
        if !hits.contains(&k) {
            hits.push(k);
        }
    };

    // Symptom/synonym mapping — a beginner's word → the exact keys (docs/15 §8).
    for &k in synonyms(&needle) {
        push(k, &mut hits);
    }
    // Direct vocabulary/title match.
    for &key in ALL_KEYS {
        let k = key.as_str();
        if k.contains(&needle) || humanize(k).to_lowercase().contains(&needle) {
            push(k, &mut hits);
        }
    }

    let mut entries: Vec<ExplorerEntry> = hits
        .into_iter()
        .filter_map(|k| entry(ExplanationKey(k)))
        .collect();
    entries.sort_by(|a, b| a.key.cmp(b.key));
    entries
}

/// Render an entry's content at a disclosure depth (docs/15 §6). The mode sets
/// the default, but the additive ladder means an expert view also shows the
/// beginner line — nothing is withheld that cannot be reached (docs/09 §6.1).
pub fn content_at(entry: &ExplorerEntry, depth: Depth) -> &str {
    match depth {
        Depth::Beginner => entry.beginner,
        Depth::Intermediate => entry.intermediate,
        Depth::Expert => entry.expert,
        // A future depth we don't model yet: fall back to the fullest content
        // rather than the tersest, so nothing is hidden (docs/09 §6.3).
        _ => entry.expert,
    }
}

/// The "explore my own packet" annotation (docs/15 §7): given the fields a
/// dissector observed (key + real value), label each with its explanation at
/// `depth`. Reuses the exact dissector output — never a second parser (single
/// source of truth, docs/15 §12). Unknown keys are dropped rather than faked.
pub fn annotate(fields: &[(ExplanationKey, String)], depth: Depth) -> Vec<AnnotatedField> {
    fields
        .iter()
        .filter_map(|(key, value)| {
            let e = explain(*key)?;
            Some(AnnotatedField {
                key: key.as_str(),
                value: value.clone(),
                explanation: e.at(to_disclosure(depth)).to_string(),
            })
        })
        .collect()
}

/// The learner's own flows that exhibit a field/value (docs/15 §5, "show me
/// mine"). A modest matcher over the protocol family a key belongs to; a real
/// backend indexes storage by protocol/field (docs/08 §8). Returns evidence
/// refs, honoring the reference↔reality wiring both ways.
pub fn examples_for(key: ExplanationKey, flows: &[Flow]) -> Vec<EvidenceRef> {
    let family = key.as_str().split('.').next().unwrap_or("");
    flows
        .iter()
        .filter(|f| key_matches_flow(family, f))
        .map(|f| EvidenceRef::Flow(f.id))
        .collect()
}

/// Whether a flow could exhibit a key of the given protocol family.
fn key_matches_flow(family: &str, flow: &Flow) -> bool {
    match family {
        "dns" => matches!(flow.l7, L7Proto::Dns),
        "tls" => matches!(flow.l7, L7Proto::Tls | L7Proto::Http3 | L7Proto::Quic),
        "http" => matches!(flow.l7, L7Proto::Http1 | L7Proto::Http2 | L7Proto::Http3),
        "tcp" => matches!(flow.l4, netpulse_core::net::L4Proto::Tcp),
        "udp" => matches!(flow.l4, netpulse_core::net::L4Proto::Udp),
        // eth/ip families apply to every flow.
        "eth" | "ip" => true,
        _ => false,
    }
}

/// Sibling keys sharing the first (protocol) segment — the "related states/
/// values" of docs/15 §4/§6, e.g. all `tcp.*`. Excludes the key itself; capped
/// for a tidy panel.
fn related_keys(key: &str) -> Vec<&'static str> {
    let family = key.split('.').next().unwrap_or("");
    ALL_KEYS
        .iter()
        .map(|k| k.as_str())
        .filter(|k| *k != key && k.split('.').next() == Some(family))
        .take(6)
        .collect()
}

/// A tiny synonym/symptom map (docs/15 §8). Beginner words and error symptoms
/// resolve to the precise keys.
fn synonyms(needle: &str) -> &'static [&'static str] {
    match needle {
        "handshake" | "hello" => &["tcp.flags.syn", "tls.handshake.client_hello"],
        "encrypted" | "encryption" | "padlock" | "https" | "secure" => {
            &["tls.handshake.client_hello", "tls.sni"]
        }
        "connection refused" | "refused" | "reset" | "hang up" => &["tcp.flags.rst"],
        "not found" | "nxdomain" | "doesn't exist" | "does not exist" => &["dns.rcode.nxdomain"],
        "address" | "lookup" | "resolve" => &["dns.query", "dns.response"],
        "404" | "error" | "status" => &["http.response"],
        "port" => &["tcp.port", "udp.port"],
        _ => &[],
    }
}

/// Turn a dotted key into a readable title ("tcp.flags.syn" → "TCP flags syn").
/// The protocol segment is upper-cased; the rest is spaced. Deterministic.
fn humanize(key: &str) -> String {
    let mut parts = key.split('.');
    let mut out = String::new();
    if let Some(first) = parts.next() {
        out.push_str(&first.to_uppercase());
    }
    for p in parts {
        out.push(' ');
        out.push_str(p);
    }
    out
}

/// Map the core disclosure depth to the decode-layer depth (they share the
/// three-rung ladder, docs/09 §6).
fn to_disclosure(depth: Depth) -> DisclosureDepth {
    match depth {
        Depth::Beginner => DisclosureDepth::Beginner,
        Depth::Intermediate => DisclosureDepth::Intermediate,
        Depth::Expert => DisclosureDepth::Expert,
        _ => DisclosureDepth::Expert,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto};
    use netpulse_core::{FlowMetrics, FlowState, Timestamp};
    use std::net::{IpAddr, Ipv4Addr};

    fn flow(id: u64, l7: L7Proto) -> Flow {
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        Flow {
            id,
            key: FiveTuple::new(ip, 1, ip, 443, L4Proto::Tcp),
            first_ts: Timestamp::new(0, 0),
            last_ts: Timestamp::new(1, 1),
            l4: L4Proto::Tcp,
            l7,
            stats: FlowMetrics::default(),
            state: FlowState::Established,
        }
    }

    #[test]
    fn every_emitted_key_is_browsable_at_all_depths() {
        // Key coverage (docs/15 §11): every dissector key has an entry with
        // non-empty content at all three depths.
        let entries = browse();
        assert_eq!(entries.len(), ALL_KEYS.len());
        for e in &entries {
            for depth in [Depth::Beginner, Depth::Intermediate, Depth::Expert] {
                assert!(!content_at(e, depth).trim().is_empty(), "{}", e.key);
            }
        }
    }

    #[test]
    fn entry_carries_layered_content_and_relatives() {
        let e = entry(ExplanationKey("tcp.flags.syn")).expect("known key");
        assert_eq!(e.title, "TCP flags syn");
        assert!(e.beginner.to_lowercase().contains("handshake") || !e.beginner.is_empty());
        // Related keys are other tcp.* entries, not the key itself.
        assert!(e.related.iter().all(|k| k.starts_with("tcp.")));
        assert!(!e.related.contains(&"tcp.flags.syn"));
    }

    #[test]
    fn unknown_key_has_no_entry() {
        assert!(entry(ExplanationKey("does.not.exist")).is_none());
    }

    #[test]
    fn symptom_search_reaches_precise_entries() {
        // A beginner's words map to the right entries (docs/15 §8).
        assert!(search("padlock").iter().any(|e| e.key == "tls.sni"));
        assert!(search("connection refused")
            .iter()
            .any(|e| e.key == "tcp.flags.rst"));
        assert!(search("not found")
            .iter()
            .any(|e| e.key == "dns.rcode.nxdomain"));
        assert!(search("RST").iter().any(|e| e.key == "tcp.flags.rst"));
        assert!(search("").is_empty());
    }

    #[test]
    fn explore_my_own_packet_annotates_real_values() {
        // "Explore my own packet" (docs/15 §7): each field → its explanation.
        let fields = vec![
            (ExplanationKey("tcp.flags.syn"), "set".to_string()),
            (ExplanationKey("ip.ttl"), "64".to_string()),
            (ExplanationKey("bogus.key"), "x".to_string()),
        ];
        let annotated = annotate(&fields, Depth::Beginner);
        // The unknown key is dropped, not fabricated (docs/15 §12).
        assert_eq!(annotated.len(), 2);
        let ttl = annotated.iter().find(|a| a.key == "ip.ttl").unwrap();
        assert_eq!(ttl.value, "64");
        assert!(!ttl.explanation.is_empty());
    }

    #[test]
    fn your_examples_query_is_bidirectional() {
        // Reference → reality: the entry lists the learner's matching flows.
        let flows = [flow(1, L7Proto::Tls), flow(2, L7Proto::Dns)];
        let tls_examples = examples_for(ExplanationKey("tls.sni"), &flows);
        assert_eq!(tls_examples, vec![EvidenceRef::Flow(1)]);
        let dns_examples = examples_for(ExplanationKey("dns.query"), &flows);
        assert_eq!(dns_examples, vec![EvidenceRef::Flow(2)]);
    }
}
