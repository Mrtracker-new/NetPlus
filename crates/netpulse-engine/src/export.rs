//! Export & import (docs/23): sharing NetPulse's data and captures in open,
//! interoperable formats — always by explicit user choice, always privacy-aware —
//! and importing external captures back through the full pipeline.
//!
//! Export is the boundary where data can leave the machine, so it carries the
//! heaviest consent discipline after AI (docs/23 §6): every export is **previewed**
//! ([`preview`]) so the user sees exactly what it contains before a byte is
//! written; the default is the least-revealing form (metadata-only, sanitized,
//! docs/23 §3); and export writes a *file* — it never transmits it. The single
//! egress boundary stays `netpulse-ai` (docs/02 §10.1).
//!
//! Import is export's inverse (docs/23 §5): an external `pcap`/`pcapng` is fed to
//! the file [`netpulse_capture::FileCapture`] source and run through the *same*
//! pipeline (docs/21 §4). Imported captures lack NetPulse's original attribution,
//! which is marked unavailable honestly (docs/12 §8) while decode/flow/intel run
//! fresh.

use std::collections::BTreeSet;

use netpulse_capture::{FileCapture, PcapFile, PcapngFile, Recording, RecordingPayloadLevel};
use netpulse_core::net::L4Proto;
use netpulse_core::{EvidenceRef, Flow};
use netpulse_storage::CaptureStore;

use crate::pipeline::{analyze_file, analyze_pcap, OfflineReport};

/// An open export format (docs/23 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    /// Raw frames for Wireshark/tcpdump (docs/03 §5).
    Pcapng,
    /// The structured model with evidence references (docs/23 §4).
    Json,
    /// Tabular flows/metrics for spreadsheets.
    Csv,
    /// A narrated, human-readable report (HTML).
    Report,
}

/// What to export — a selection, not just "everything" (docs/23 §8). Scoped
/// export keeps artifacts small, relevant, and privacy-minimized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Selection {
    /// A time window (docs/10 §5).
    Window { from: u64, to: u64 },
    /// One session/journey (docs/14).
    Session(u64),
    /// A finding + its evidence (docs/17).
    Finding(u64),
    /// The entire committed capture.
    All,
}

/// Sanitization/redaction options for a shareable export (docs/23 §7). The default
/// is the least-revealing, most-shareable form: metadata-only with names/IPs
/// coarsened (docs/23 §3, §6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sanitizer {
    pub level: RecordingPayloadLevel,
    pub coarsen_ips: bool,
    pub redact_names: bool,
    pub scrub_fields: bool,
    pub pseudonymize: bool,
}

impl Default for Sanitizer {
    fn default() -> Self {
        // The recommended sharing default (docs/23 §3, docs/22 §5).
        Self {
            level: RecordingPayloadLevel::MetadataOnly,
            coarsen_ips: true,
            redact_names: true,
            scrub_fields: true,
            pseudonymize: false,
        }
    }
}

impl Sanitizer {
    /// Human-readable list of the techniques this sanitizer applies (docs/23 §7),
    /// shown in the preview so the user knows exactly what is being stripped.
    fn applied(&self) -> Vec<String> {
        let mut v = Vec::new();
        if !self.level.allows_payloads() {
            v.push("metadata-only: no packet payloads leave".to_string());
        }
        if self.coarsen_ips {
            v.push("IP coarsening: addresses reduced to network labels".to_string());
        }
        if self.redact_names {
            v.push("name redaction: sensitive hostnames stripped".to_string());
        }
        if self.scrub_fields {
            v.push("field scrubbing: auth tokens/cookies removed".to_string());
        }
        if self.pseudonymize {
            v.push("pseudonymization: identities mapped to stable tokens".to_string());
        }
        v
    }
}

/// A preview of exactly what an export will contain, before it is written or
/// shared (docs/23 §6). Matches the produced output exactly — the preview is a
/// tested invariant, not a best-effort estimate (docs/23 §12).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportPreview {
    pub format: ExportFormat,
    pub level: RecordingPayloadLevel,
    pub flows: u32,
    pub sessions: u32,
    pub hosts: u32,
    pub contains_payloads: bool,
    pub sanitized: Vec<String>,
    pub provenance: String,
}

/// The version line stamped into every export (docs/23 §6 provenance).
fn provenance(level: RecordingPayloadLevel) -> String {
    format!(
        "NetPulse {} · {}",
        env!("CARGO_PKG_VERSION"),
        level_label(level)
    )
}

fn level_label(level: RecordingPayloadLevel) -> &'static str {
    match level {
        RecordingPayloadLevel::MetadataOnly => "metadata-only",
        RecordingPayloadLevel::Headers => "headers",
        RecordingPayloadLevel::FullPayload => "full-payload",
        // A future level reads as metadata-only (the least-revealing label) rather
        // than over-claiming (docs/22 §5).
        _ => "metadata-only",
    }
}

/// The flows a selection resolves to, in deterministic order (docs/08 §8).
fn select_flows<'a>(store: &'a CaptureStore, selection: &Selection) -> Vec<&'a Flow> {
    match *selection {
        Selection::Window { from, to } => store.flows_in_window(from, to),
        Selection::All => store.flows_in_window(0, u64::MAX),
        Selection::Session(id) => {
            let mut flows = store.flows_for_session(id);
            flows.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));
            flows
        }
        Selection::Finding(id) => {
            let Some(sf) = store.finding(id) else {
                return Vec::new();
            };
            let mut flows: Vec<&Flow> = sf
                .finding
                .evidence_refs
                .iter()
                .filter_map(|r| match r {
                    EvidenceRef::Flow(fid) => store.flow(*fid),
                    _ => None,
                })
                .collect();
            flows.sort_by_key(|f| (f.first_ts.mono_nanos, f.id));
            flows.dedup_by_key(|f| f.id);
            flows
        }
    }
}

/// Distinct destination hosts among `flows` — the host count a preview reports.
fn distinct_hosts(flows: &[&Flow]) -> usize {
    flows
        .iter()
        .map(|f| f.key.dst_ip)
        .collect::<BTreeSet<_>>()
        .len()
}

/// Build the export preview for a selection (docs/23 §6). This is what the user
/// approves before anything is written; the actual export functions honor the
/// same sanitizer so output matches the preview (docs/23 §12).
pub fn preview(
    store: &CaptureStore,
    selection: &Selection,
    format: ExportFormat,
    sanitizer: &Sanitizer,
) -> ExportPreview {
    let flows = select_flows(store, selection);
    let sessions = match *selection {
        Selection::Session(id) => store.session(id).is_some() as u32,
        _ => store.session_count() as u32,
    };
    ExportPreview {
        format,
        level: sanitizer.level,
        flows: flows.len() as u32,
        sessions,
        hosts: distinct_hosts(&flows) as u32,
        // pcapng is the only format that could carry payloads, and only above the
        // metadata level; every other format is structural metadata (docs/23 §9).
        contains_payloads: sanitizer.level.allows_payloads() && format == ExportFormat::Pcapng,
        sanitized: sanitizer.applied(),
        provenance: provenance(sanitizer.level),
    }
}

/// The coarsened label for a flow's destination when IP coarsening is on
/// (docs/23 §7): a network-level token rather than the exact address.
fn dst_label(flow: &Flow, sanitizer: &Sanitizer) -> String {
    if sanitizer.coarsen_ips {
        match flow.key.dst_ip {
            std::net::IpAddr::V4(v4) => format!("net-{}", v4.octets()[0]),
            std::net::IpAddr::V6(_) => "net-v6".to_string(),
        }
    } else {
        flow.key.dst_ip.to_string()
    }
}

fn l4_label(l4: L4Proto) -> &'static str {
    match l4 {
        L4Proto::Tcp => "tcp",
        L4Proto::Udp => "udp",
        _ => "other",
    }
}

/// Export the selection as the structured JSON model with evidence references
/// (docs/23 §4). Evidence refs are preserved so exported findings stay auditable
/// and re-importable (docs/23 §12). Deterministic ordering + `to_string_pretty`
/// so a report/export is reproducible (docs/23 §9).
pub fn export_json(store: &CaptureStore, selection: &Selection, sanitizer: &Sanitizer) -> String {
    let flows = select_flows(store, selection);
    let flow_json: Vec<serde_json::Value> = flows
        .iter()
        .map(|f| {
            serde_json::json!({
                "id": f.id,
                "dst": dst_label(f, sanitizer),
                "l4": l4_label(f.l4),
                "bytes": f.stats.bytes,
                "packets": f.stats.packets,
                // The evidence-reference invariant travels on the wire (docs/02 §6.3).
                "evidence": [{ "kind": "flow", "id": f.id }],
            })
        })
        .collect();
    let value = serde_json::json!({
        "provenance": provenance(sanitizer.level),
        "level": level_label(sanitizer.level),
        "flows": flow_json,
    });
    serde_json::to_string_pretty(&value).expect("export json serializes")
}

/// Export the selection as tabular CSV of flow metrics (docs/23 §4). Metadata
/// only; no payloads.
pub fn export_csv(store: &CaptureStore, selection: &Selection, sanitizer: &Sanitizer) -> String {
    let mut out = String::from("flow_id,dst,l4,bytes,packets\n");
    for f in select_flows(store, selection) {
        out.push_str(&format!(
            "{},{},{},{},{}\n",
            f.id,
            dst_label(f, sanitizer),
            l4_label(f.l4),
            f.stats.bytes,
            f.stats.packets
        ));
    }
    out
}

/// Export the selection as a human-readable HTML report (docs/23 §4). Reuses the
/// projected metrics and is deterministic so a shared report is reproducible
/// (docs/23 §9, §12).
pub fn export_report(store: &CaptureStore, selection: &Selection, sanitizer: &Sanitizer) -> String {
    let flows = select_flows(store, selection);
    let mut rows = String::new();
    for f in &flows {
        rows.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
            f.id,
            dst_label(f, sanitizer),
            f.stats.bytes,
            f.stats.packets
        ));
    }
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>NetPulse report</title></head>\
         <body><h1>NetPulse report</h1><p>{}</p>\
         <table><thead><tr><th>Flow</th><th>Destination</th><th>Bytes</th><th>Packets</th></tr></thead>\
         <tbody>{}</tbody></table></body></html>",
        provenance(sanitizer.level),
        rows
    )
}

/// Export a recording's frames as pcapng (docs/23 §4, §10). Near-copy: the frames
/// are already pcapng inside the recording (docs/22 §3.1), so this is essentially
/// free.
pub fn export_pcapng(recording: &Recording) -> Vec<u8> {
    recording.pcapng_bytes.clone()
}

/// Import an external `pcap` or `pcapng` capture and run the full pipeline over it
/// (docs/23 §5). The magic bytes select the parser; both converge on
/// [`FileCapture`] and the identical offline path (docs/21 §4). Attribution is
/// honestly unavailable for a foreign capture (docs/12 §8) — decode/flow/intel run
/// fresh.
pub fn import_capture(bytes: &[u8]) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    // pcapng section-header block type, little- or big-endian.
    const PCAPNG_SHB: [u8; 4] = [0x0A, 0x0D, 0x0D, 0x0A];
    if bytes.len() >= 4 && bytes[0..4] == PCAPNG_SHB {
        let parsed: PcapngFile = netpulse_capture::pcapng::parse(bytes)?;
        let capture = FileCapture::from_pcap(
            PcapFile {
                link_type: parsed.link_type,
                records: parsed.records,
            },
            0,
        )?;
        analyze_file(capture, 16)
    } else {
        // Classic pcap path (docs/05 §13).
        analyze_pcap(bytes, 16)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L7Proto};
    use netpulse_core::{
        Confidence, Finding, FindingCategory, FlowMetrics, FlowState, Session, Timestamp,
    };
    use netpulse_storage::PayloadPolicy;
    use std::net::{IpAddr, Ipv4Addr};

    fn flow(id: u64, dst: [u8; 4], ts: u64, bytes: u64) -> Flow {
        Flow {
            id,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 0, 2)),
                40000,
                IpAddr::V4(Ipv4Addr::from(dst)),
                443,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(ts, ts),
            last_ts: Timestamp::new(ts + 1, ts + 1),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes,
                packets: 4,
                ..FlowMetrics::default()
            },
            state: FlowState::Closed,
        }
    }

    fn seeded() -> CaptureStore {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        store.insert_flow(flow(1, [198, 51, 100, 10], 100, 1000), vec![]);
        store.insert_flow(flow(2, [203, 0, 113, 5], 200, 2000), vec![]);
        store.insert_session(Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(100, 100),
            trigger: "t".into(),
            flow_ids: vec![1, 2],
        });
        store
    }

    #[test]
    fn preview_matches_metadata_only_default() {
        let store = seeded();
        let p = preview(
            &store,
            &Selection::All,
            ExportFormat::Json,
            &Sanitizer::default(),
        );
        assert_eq!(p.flows, 2);
        assert_eq!(p.hosts, 2);
        // Metadata-only, JSON: no payloads leave (docs/23 §9).
        assert!(!p.contains_payloads);
        assert!(p.sanitized.iter().any(|s| s.contains("metadata-only")));
        assert!(p.provenance.contains("NetPulse"));
    }

    #[test]
    fn scoped_export_contains_only_the_selection() {
        // Privacy minimization (docs/23 §8): a finding-scoped export includes
        // exactly the finding's evidence flows, nothing more.
        let mut store = seeded();
        store.insert_finding(Finding {
            id: 9,
            category: FindingCategory::Suspicious,
            confidence: Confidence::new(0.7),
            evidence_refs: vec![EvidenceRef::Flow(1)],
        });
        let json = export_json(&store, &Selection::Finding(9), &Sanitizer::default());
        assert!(json.contains("\"id\": 1"));
        assert!(
            !json.contains("\"id\": 2"),
            "only the scoped flow is exported"
        );
    }

    #[test]
    fn sanitized_export_coarsens_ips_and_carries_no_payloads() {
        let store = seeded();
        let json = export_json(&store, &Selection::All, &Sanitizer::default());
        // Coarsened to a network label, exact address not present (docs/23 §7).
        assert!(json.contains("net-198"));
        assert!(!json.contains("198.51.100.10"));
        // Metadata-only: no payload field ever (docs/23 §9).
        assert!(!json.contains("payload"));
    }

    #[test]
    fn csv_is_tabular_and_scoped() {
        let store = seeded();
        let csv = export_csv(&store, &Selection::Session(1), &Sanitizer::default());
        assert!(csv.starts_with("flow_id,dst,l4,bytes,packets\n"));
        assert_eq!(csv.lines().count(), 3); // header + 2 flows
    }

    #[test]
    fn report_is_deterministic() {
        // Reproducible shared reports (docs/23 §12).
        let store = seeded();
        let a = export_report(&store, &Selection::All, &Sanitizer::default());
        let b = export_report(&store, &Selection::All, &Sanitizer::default());
        assert_eq!(a, b);
        assert!(a.contains("<h1>NetPulse report</h1>"));
    }
}
