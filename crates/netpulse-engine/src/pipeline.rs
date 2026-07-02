//! The offline analysis pipeline (docs/05 §13, docs/04 §11): capture-from-file →
//! decode → flow/session reconstruction → storage. It wires the Phase 1 layers
//! into the exact sequence a live engine uses, but driven by a pcap fixture so
//! it runs deterministically and without privileges (docs/03 §12, docs/05 §12).
//!
//! ```text
//! FileCapture ──frames──▶ decode_frame ──Decoded──▶ PacketView
//!      │                                                 │
//!      └──────────────── capture ts (mono+wall) ─────────┘
//!                                                         ▼
//!                                                    FlowEngine
//!                                              (flows + sessions + events)
//!                                                         ▼
//!                                                    CaptureStore
//! ```
//!
//! This is the concrete realization of "capture from wire and capture from file
//! converge immediately after this layer" (docs/05 §13).

use netpulse_api::dto::{MonitorSnapshotDto, NarrativeCardDto};
use netpulse_capture::{CaptureStats, FileCapture};
use netpulse_core::traits::CaptureSource;
use netpulse_core::{Depth, Session, Timestamp};
use netpulse_decode::decode_frame;
use netpulse_flow::{FlowEngine, PacketView};
use netpulse_narrative::{build_cards, SessionView};
use netpulse_storage::{CaptureStore, PayloadPolicy};

use crate::monitor::{self, LossAccounting};
use crate::project;

/// A summary of one offline run, for reporting and tests (docs/05 §12 golden
/// reconstructions).
#[derive(Debug, Clone)]
pub struct OfflineReport {
    pub frames_read: usize,
    pub packets_decoded: usize,
    /// Frames the decoder could not turn into a flow packet (non-IP, ICMP, …).
    pub non_flow_frames: usize,
    pub flows: usize,
    pub sessions: usize,
    pub causal_links: usize,
}

/// Run the full offline pipeline over an in-memory pcap capture, persisting the
/// reconstruction into `store` and returning a summary.
///
/// `shards` sets the flow engine's shard count (docs/06 §7). The store's payload
/// policy governs whether any payload bytes could be written (they are not, in
/// this metadata pipeline — docs/08 §4).
pub fn run_offline(
    pcap_bytes: &[u8],
    shards: u16,
    store: &mut CaptureStore,
) -> netpulse_core::Result<OfflineReport> {
    let mut capture = FileCapture::from_bytes(pcap_bytes, 0)?;
    let link = capture.link_type();
    let mut engine = FlowEngine::new(shards);

    let mut frames_read = 0usize;
    let mut packets_decoded = 0usize;
    let mut non_flow_frames = 0usize;
    let mut global_index = 0usize;

    loop {
        let batch = capture.next_batch()?;
        if batch.is_empty() {
            break;
        }
        for frame in &batch {
            frames_read += 1;
            let decoded = decode_frame(link, &frame.bytes);
            // Pair the capture-time monotonic reading (from the frame) with the
            // wall-clock reading (from the pcap record) — never mix them
            // (docs/05 §6).
            let wall = capture
                .wall_nanos_at(global_index)
                .unwrap_or(frame.mono_nanos);
            global_index += 1;
            let ts = Timestamp::new(frame.mono_nanos, wall);
            match PacketView::from_decoded(ts, &decoded) {
                Some(pv) => {
                    packets_decoded += 1;
                    engine.ingest(&pv);
                }
                None => non_flow_frames += 1,
            }
        }
    }

    let causal_links = engine.causal_links().len();
    let (flows, sessions) = engine.finish();

    let flow_count = flows.len();
    for ff in flows {
        store.insert_flow(ff.flow, ff.events);
    }
    let session_count = sessions.len();
    persist_sessions(store, sessions);

    Ok(OfflineReport {
        frames_read,
        packets_decoded,
        non_flow_frames,
        flows: flow_count,
        sessions: session_count,
        causal_links,
    })
}

fn persist_sessions(store: &mut CaptureStore, sessions: Vec<Session>) {
    for s in sessions {
        store.insert_session(s);
    }
}

/// Convenience: run the pipeline into a fresh metadata-only store (the private
/// default, docs/08 §4) and return both the store and the report.
pub fn analyze_pcap(
    pcap_bytes: &[u8],
    shards: u16,
) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    let report = run_offline(pcap_bytes, shards, &mut store)?;
    Ok((store, report))
}

/// The Phase 2 presentation projection of a completed run (docs/09, docs/11):
/// the narrative feed and the monitoring snapshot, already in the `netpulse-api`
/// wire shapes at a chosen [`Depth`]. This is the bundle a UI receives; it is a
/// pure read-only *view* over the store (docs/11 §14), computed after the
/// pipeline has committed its reconstruction.
#[derive(Debug, Clone)]
pub struct PresentationView {
    pub narratives: Vec<NarrativeCardDto>,
    pub monitor: MonitorSnapshotDto,
}

/// Build the presentation view from a committed store at the given disclosure
/// depth (docs/09 §6.3). `capture_stats` carries the honest capture-drop count
/// so the monitor snapshot can keep capture loss distinct from network loss
/// (docs/11 §6.4); pass [`CaptureStats::default`] for a lossless offline run.
pub fn present(
    store: &CaptureStore,
    depth: Depth,
    capture_stats: CaptureStats,
) -> PresentationView {
    // --- Narrative feed: one card per session, over the store query surface ---
    // Own the flow/event clones so the borrowed SessionViews can reference them
    // for the duration of card building (docs/04 §3.6: narrative is a projection
    // fed by the caller, which gathers from storage per docs/08 §8).
    let session_ids = store.session_ids();
    let mut owned: Vec<(
        Session,
        Vec<netpulse_core::Flow>,
        Vec<netpulse_core::ProtoEvent>,
    )> = Vec::with_capacity(session_ids.len());
    for sid in session_ids {
        let Some(session) = store.session(sid) else {
            continue;
        };
        let flows: Vec<netpulse_core::Flow> =
            store.flows_for_session(sid).into_iter().cloned().collect();
        let mut events: Vec<netpulse_core::ProtoEvent> = Vec::new();
        for f in &flows {
            events.extend(store.events_for_flow(f.id).iter().cloned());
        }
        owned.push((session.clone(), flows, events));
    }
    let views: Vec<SessionView> = owned
        .iter()
        .map(|(s, flows, events)| {
            SessionView::new(s, flows.iter().collect(), events.iter().collect())
        })
        .collect();
    let narratives = build_cards(&views)
        .iter()
        .map(|c| project::card_dto(c, depth))
        .collect();

    // --- Monitoring snapshot over the full window (docs/11 §5) ---
    let all_flows: Vec<&netpulse_core::Flow> = store.flows_in_window(0, u64::MAX);
    let network_loss: u32 = all_flows.iter().map(|f| f.stats.loss_indicators).sum();
    let loss = LossAccounting {
        network_loss_indicators: network_loss,
        capture_drops: capture_stats.dropped,
    };
    let snap = monitor::snapshot(&all_flows, loss, None);

    PresentationView {
        narratives,
        monitor: project::monitor_dto(&snap),
    }
}
