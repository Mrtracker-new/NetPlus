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
use netpulse_capture::{CaptureStats, FileCapture, FrameFeed, Recording, ReplaySource};
use netpulse_core::traits::RawFrame;
use netpulse_core::{Depth, Session, Timestamp};
use netpulse_decode::{decode_frame, LinkType};
use netpulse_flow::{FlowEngine, PacketView};
use netpulse_narrative::{build_cards, SessionView};
use netpulse_storage::{CaptureStore, PayloadPolicy};

use crate::monitor::{self, LossAccounting};
use crate::project;

/// A summary of one offline run, for reporting and tests (docs/05 §12 golden
/// reconstructions). `PartialEq` powers the live-vs-replay parity test (docs/21
/// §10): a replayed run's report must equal the original's.
#[derive(Debug, Clone, PartialEq, Eq)]
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
#[tracing::instrument(level = "info", skip(pcap_bytes), fields(bytes_processed = pcap_bytes.len()))]
pub fn run_offline(
    pcap_bytes: &[u8],
    shards: u16,
    store: &mut CaptureStore,
) -> netpulse_core::Result<OfflineReport> {
    let capture = FileCapture::from_bytes(pcap_bytes, 0)?;
    run_feed(capture, shards, store)
}

/// Replay a recording deterministically through the **same** pipeline (docs/21 §4).
/// The only thing that changes from [`run_offline`] is the frame source — a
/// [`ReplaySource`] over the recording instead of a file — which is what
/// guarantees replay reconstructs exactly what the original capture produced
/// (docs/21 §6, §10 live-vs-replay parity).
pub fn run_replay(
    recording: &Recording,
    shards: u16,
    store: &mut CaptureStore,
) -> netpulse_core::Result<OfflineReport> {
    let source = ReplaySource::from_recording(recording)?;
    run_feed(source, shards, store)
}

/// The one pipeline loop, generic over its frame source (docs/21 §4 — "one
/// pipeline, two sources"). Both file-import and replay drive it, so what a user
/// sees in replay is exactly what the engine did (or would do) live, with no
/// divergent "replay mode" logic to drift.
fn run_feed<S: FrameFeed>(
    mut capture: S,
    shards: u16,
    store: &mut CaptureStore,
) -> netpulse_core::Result<OfflineReport> {
    let start_time = std::time::Instant::now();
    tracing::debug!(
        event = "pipeline.analysis_started",
        "Pipeline feed execution started"
    );

    let link = capture.link_type();
    let mut engine = FlowEngine::new(shards);

    let mut frames_read = 0usize;
    let mut packets_decoded = 0usize;
    let mut non_flow_frames = 0usize;
    let mut global_index = 0usize;

    loop {
        let batch = capture.next_frames()?;
        if batch.is_empty() {
            break;
        }
        for frame in &batch {
            frames_read += 1;
            let decoded = decode_frame(link, &frame.bytes);
            // Pair the capture-time monotonic reading (from the frame) with the
            // wall-clock reading (from the source) — never mix them (docs/05 §6),
            // and never `now()` (docs/21 §6: determinism on the processing path).
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
    // Passive name table (DNS answers + TLS SNI) — read before `finish`, which
    // borrows the engine mutably; it is accumulated state, not drained by finish.
    let resolutions = engine.resolutions();
    let (flows, sessions) = engine.finish();

    let flow_count = flows.len();
    for ff in flows {
        store.insert_flow(ff.flow, ff.events);
    }
    let session_count = sessions.len();
    persist_sessions(store, sessions);
    for (ip, names) in resolutions {
        store.set_resolution(ip, names);
    }

    let analysis_ms = start_time.elapsed().as_millis() as u64;
    tracing::debug!(
        event = "pipeline.analysis_completed",
        analysis_ms = analysis_ms,
        frames_read = frames_read,
        packets_decoded = packets_decoded,
        flows_created = flow_count,
        sessions_created = session_count,
        causal_links = causal_links,
        "Pipeline feed execution completed"
    );

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

/// Run the pipeline over an already-built file source into a fresh metadata-only
/// store. Used by import (docs/23 §5): both classic pcap and pcapng resolve to a
/// [`FileCapture`], then reuse the identical offline path (docs/21 §4).
pub fn analyze_file(
    capture: FileCapture,
    shards: u16,
) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    let report = run_feed(capture, shards, &mut store)?;
    Ok((store, report))
}

/// Map a libpcap link-layer type (DLT) to the decoder's [`LinkType`] (docs/07
/// §4.2). Mirrors the pcap file reader's mapping so live and file captures decode
/// identically. `1` (Ethernet) is the near-universal case and the default.
pub fn link_type_from_dlt(dlt: u32) -> LinkType {
    match dlt {
        0 => LinkType::Loopback,          // DLT_NULL
        12 | 14 | 101 => LinkType::RawIp, // DLT_RAW family
        _ => LinkType::Ethernet,          // 1 = EN10MB, and the safe default
    }
}

/// A [`FrameFeed`] over frames already captured in memory — the seam for **live
/// capture** (docs/05 §12). The live loop accumulates [`RawFrame`]s from the
/// platform backend and periodically feeds a snapshot through this, so live
/// reconstruction runs the *exact same* pipeline as file import and replay
/// (docs/21 §4). Wall time falls back to each frame's monotonic reading (the live
/// frames already carry a monotonic base — docs/05 §6).
struct SliceFeed<'a> {
    link: LinkType,
    frames: &'a [RawFrame],
    cursor: usize,
    batch: usize,
}

impl FrameFeed for SliceFeed<'_> {
    fn link_type(&self) -> LinkType {
        self.link
    }

    fn wall_nanos_at(&self, _i: usize) -> Option<u64> {
        None
    }

    fn next_frames(&mut self) -> netpulse_core::Result<Vec<RawFrame>> {
        if self.cursor >= self.frames.len() {
            return Ok(Vec::new());
        }
        let end = (self.cursor + self.batch).min(self.frames.len());
        let out = self.frames[self.cursor..end].to_vec();
        self.cursor = end;
        Ok(out)
    }
}

/// Reconstruct a store from a batch of live-captured frames (docs/05 §12). Runs
/// the identical offline pipeline over an in-memory [`SliceFeed`], so what a user
/// sees live is exactly what file import / replay would produce (docs/21 §4).
/// `dlt` is the interface's libpcap link type (see [`link_type_from_dlt`]).
#[tracing::instrument(level = "debug", skip(frames), fields(frames_count = frames.len()))]
pub fn analyze_frames(
    dlt: u32,
    frames: &[RawFrame],
    shards: u16,
) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    let feed = SliceFeed {
        link: link_type_from_dlt(dlt),
        frames,
        cursor: 0,
        batch: 256,
    };
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    let report = run_feed(feed, shards, &mut store)?;
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
    let snap = monitor::snapshot(&all_flows, loss, None, store.resolutions());

    PresentationView {
        narratives,
        monitor: project::monitor_dto(&snap),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_capture::{PcapFile, Recorder, RecordingScope};

    /// A minimal little-endian, microsecond pcap with `frames` Ethernet records,
    /// each 1 ms apart. The frames need not form flows for the parity test — what
    /// matters is that both sources see identical bytes and timestamps.
    fn tiny_pcap(frames: &[&[u8]]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&0xa1b2c3d4u32.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes());
        b.extend_from_slice(&4u16.to_le_bytes());
        b.extend_from_slice(&0i32.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
        b.extend_from_slice(&65535u32.to_le_bytes());
        b.extend_from_slice(&1u32.to_le_bytes()); // Ethernet
        for (i, f) in frames.iter().enumerate() {
            b.extend_from_slice(&1000u32.to_le_bytes()); // ts sec
            b.extend_from_slice(&((i as u32) * 1000).to_le_bytes()); // ts usec
            b.extend_from_slice(&(f.len() as u32).to_le_bytes());
            b.extend_from_slice(&(f.len() as u32).to_le_bytes());
            b.extend_from_slice(f);
        }
        b
    }

    /// Build a recording from the same pcap the live path reads, so replay drives
    /// identical frames/timestamps (docs/22 fidelity feeds docs/21 §10 parity).
    fn recording_from_pcap(pcap_bytes: &[u8]) -> netpulse_capture::Recording {
        let pcap = PcapFile::parse(pcap_bytes).unwrap();
        let base = pcap
            .records
            .first()
            .map(|r| r.ts_secs * 1_000_000_000 + r.ts_nanos as u64)
            .unwrap_or(0);
        let mut rec = Recorder::start(pcap.link_type, RecordingScope::default());
        for r in &pcap.records {
            let wall = r.ts_secs * 1_000_000_000 + r.ts_nanos as u64;
            rec.push(wall.saturating_sub(base), r.clone());
        }
        rec.finalize(netpulse_api::API_VERSION)
    }

    #[test]
    fn live_and_replay_reconstructions_match() {
        // docs/21 §10: capture live into a recording, then replay; the replayed
        // reconstruction must equal what the live run produced.
        let pcap = tiny_pcap(&[&[0xde, 0xad, 0xbe, 0xef], &[1, 2, 3, 4, 5, 6]]);

        let (store_live, report_live) = analyze_pcap(&pcap, 8).unwrap();

        let recording = recording_from_pcap(&pcap);
        let mut store_replay = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let report_replay = run_replay(&recording, 8, &mut store_replay).unwrap();

        assert_eq!(report_live, report_replay);
        assert_eq!(store_live.flow_count(), store_replay.flow_count());
        assert_eq!(store_live.session_count(), store_replay.session_count());
    }

    #[test]
    fn replay_is_repeatable() {
        // The determinism meta-test at the pipeline level (docs/21 §10): two
        // replays of one recording yield identical reports.
        let pcap = tiny_pcap(&[&[9, 9, 9, 9]]);
        let recording = recording_from_pcap(&pcap);
        let mut s1 = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let mut s2 = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let r1 = run_replay(&recording, 8, &mut s1).unwrap();
        let r2 = run_replay(&recording, 8, &mut s2).unwrap();
        assert_eq!(r1, r2);
    }
}
