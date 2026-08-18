//! The offline analysis pipeline: capture-from-file →
//! decode → flow/session reconstruction → storage. It wires the Phase 1 layers
//! into the exact sequence a live engine uses, but driven by a pcap fixture so
//! it runs deterministically and without privileges.
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
//! converge immediately after this layer".

use netpulse_api::dto::{MonitorSnapshotDto, NarrativeCardDto};
use netpulse_capture::{CaptureStats, FileCapture, FrameFeed, Recording, ReplaySource};
use netpulse_core::traits::RawFrame;
use netpulse_core::{Depth, Session, Timestamp};
use netpulse_decode::{decode_frame, LinkType};
use netpulse_flow::{FlowEngine, PacketView};
use netpulse_narrative::{build_cards, SessionView};
use netpulse_storage::repository::CaptureRepository;
use netpulse_storage::{CaptureStore, PayloadPolicy};

use crate::monitor::{self, LossAccounting};
use crate::project;

/// A summary of one offline run, for reporting and tests ( golden
/// reconstructions). `PartialEq` powers the live-vs-replay parity test:
/// a replayed run's report must equal the original's.
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
/// `shards` sets the flow engine's shard count. The store's payload
/// policy governs whether any payload bytes could be written (they are not, in
/// this metadata pipeline — .
#[tracing::instrument(level = "info", skip(pcap_bytes), fields(bytes_processed = pcap_bytes.len()))]
pub fn run_offline<R: CaptureRepository>(
    pcap_bytes: &[u8],
    shards: u16,
    store: &mut CaptureStore<R>,
) -> netpulse_core::Result<OfflineReport> {
    let capture = FileCapture::from_bytes(pcap_bytes, 0)?;
    run_feed(capture, shards, store)
}

/// Replay a recording deterministically through the **same** pipeline.
/// The only thing that changes from [`run_offline`] is the frame source — a
/// [`ReplaySource`] over the recording instead of a file — which is what
/// guarantees replay reconstructs exactly what the original capture produced
///
pub fn run_replay<R: CaptureRepository>(
    recording: &Recording,
    shards: u16,
    store: &mut CaptureStore<R>,
) -> netpulse_core::Result<OfflineReport> {
    let source = ReplaySource::from_recording(recording)?;
    run_feed(source, shards, store)
}

/// The one pipeline loop, generic over its frame source ( — "one
/// pipeline, two sources"). Both file-import and replay drive it, so what a user
/// sees in replay is exactly what the engine did (or would do) live, with no
/// divergent "replay mode" logic to drift.
fn run_feed<S: FrameFeed, R: CaptureRepository>(
    mut capture: S,
    shards: u16,
    store: &mut CaptureStore<R>,
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
            let wall = capture
                .wall_nanos_at(global_index)
                .unwrap_or(frame.mono_nanos);
            let ts = Timestamp::new(frame.mono_nanos, wall);
            if let Some(pv) = PacketView::from_decoded(ts, &decoded) {
                packets_decoded += 1;
                engine.ingest(&pv);
            } else {
                non_flow_frames += 1;
            }
            global_index += 1;
        }
    }

    let (flows, sessions) = engine.finish();
    let flows_count = flows.len();
    let sessions_count = sessions.len();
    let causal_links = sessions.iter().map(|s| s.flow_ids.len()).sum();

    for ff in flows {
        store.insert_flow(ff.flow, ff.events);
    }
    for s in sessions {
        store.insert_session(s);
    }
    for (ip, names) in engine.resolutions() {
        store.set_resolution(ip, names);
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    tracing::info!(
        event = "pipeline.analysis_completed",
        frames_read = frames_read,
        packets_decoded = packets_decoded,
        flows = flows_count,
        sessions = sessions_count,
        causal_links = causal_links,
        duration_ms = duration_ms,
        "Pipeline analysis finished successfully"
    );

    Ok(OfflineReport {
        frames_read,
        packets_decoded,
        non_flow_frames,
        flows: flows_count,
        sessions: sessions_count,
        causal_links,
    })
}

/// Convenience: run the pipeline into a fresh metadata-only store (the private
/// default and return both the store and the report.
pub fn analyze_pcap(
    pcap_bytes: &[u8],
    shards: u16,
) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    let report = run_offline(pcap_bytes, shards, &mut store)?;
    Ok((store, report))
}

/// Run the pipeline over an already-built file source into a fresh metadata-only
/// store. Used by import: both classic pcap and pcapng resolve to a
/// [`FileCapture`], then reuse the identical offline path.
pub fn analyze_file(
    capture: FileCapture,
    shards: u16,
) -> netpulse_core::Result<(CaptureStore, OfflineReport)> {
    let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
    let report = run_feed(capture, shards, &mut store)?;
    Ok((store, report))
}

/// Map a libpcap link-layer type (DLT) to the decoder's [`LinkType`].
/// Mirrors the pcap file reader's mapping so live and file captures decode
/// identically. `1` (Ethernet) is the near-universal case and the default.
pub fn link_type_from_dlt(dlt: u32) -> LinkType {
    match dlt {
        0 => LinkType::Loopback,          // DLT_NULL
        12 | 14 | 101 => LinkType::RawIp, // DLT_RAW family
        _ => LinkType::Ethernet,          // 1 = EN10MB, and the safe default
    }
}

/// A [`FrameFeed`] over frames already captured in memory — the seam for **live
/// capture**.
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

/// Reconstruct a store from a batch of live-captured frames.
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

/// An incremental live capture pipeline that ingests raw frames as they arrive,
/// updates flow & session state in [`FlowEngine`] O(1) per packet, and periodically
/// commits dirty state snapshots to [`CaptureStore`] (O(K_dirty)).
#[derive(Debug)]
pub struct LivePipeline {
    engine: FlowEngine,
    link: LinkType,
    last_mono: u64,
}

impl LivePipeline {
    /// Create a new live pipeline for interface link type `dlt` (libpcap DLT).
    pub fn new(dlt: u32, shards: u16) -> Self {
        Self {
            engine: FlowEngine::new(shards),
            link: link_type_from_dlt(dlt),
            last_mono: 0,
        }
    }

    /// Ingest a batch of newly arrived raw frames into the incremental flow engine.
    pub fn ingest_batch(&mut self, frames: &[RawFrame]) {
        for frame in frames {
            self.last_mono = self.last_mono.max(frame.mono_nanos);
            let decoded = decode_frame(self.link, &frame.bytes);
            let ts = Timestamp::new(frame.mono_nanos, frame.mono_nanos);
            if let Some(pv) = PacketView::from_decoded(ts, &decoded) {
                self.engine.ingest(&pv);
            }
        }
    }

    /// Commit dirty flow, session, and resolution updates to `store`.
    pub fn commit_to_store<R: CaptureRepository>(
        &mut self,
        store: &mut CaptureStore<R>,
        now_mono: u64,
    ) {
        let ts = Timestamp::new(now_mono, now_mono);
        // 1. Tick engine to evict closed flows and get dirty sessions
        let (closed_flows, dirty_sessions) = self.engine.tick(ts);
        for ff in closed_flows {
            store.insert_flow(ff.flow, ff.events);
        }

        // 2. Snapshot and commit all dirty active flows
        let dirty_flows = self.engine.snapshot_dirty_flows();
        for ff in dirty_flows {
            store.insert_flow(ff.flow, ff.events);
        }

        // 3. Commit dirty sessions
        for s in dirty_sessions {
            store.insert_session(s);
        }

        // 4. Merge resolution table updates
        for (ip, names) in self.engine.resolutions() {
            store.set_resolution(ip, names);
        }

        // 5. Enforce storage bounds
        store.auto_evict_if_needed();
    }

    /// Commit dirty flow, session, and resolution updates asynchronously to `store` (and its backing repository).
    pub async fn commit_to_store_async<R: CaptureRepository>(
        &mut self,
        store: &mut CaptureStore<R>,
        now_mono: u64,
    ) {
        let ts = Timestamp::new(now_mono, now_mono);
        // 1. Tick engine to evict closed flows and get dirty sessions
        let (closed_flows, dirty_sessions) = self.engine.tick(ts);
        for ff in closed_flows {
            store.insert_flow_async(ff.flow, ff.events).await;
        }

        // 2. Snapshot and commit all dirty active flows
        let dirty_flows = self.engine.snapshot_dirty_flows();
        for ff in dirty_flows {
            store.insert_flow_async(ff.flow, ff.events).await;
        }

        // 3. Commit dirty sessions
        for s in dirty_sessions {
            store.insert_session_async(s).await;
        }

        // 4. Merge resolution table updates
        for (ip, names) in self.engine.resolutions() {
            store.set_resolution_async(ip, names).await;
        }

        // 5. Enforce storage bounds
        store.auto_evict_if_needed();
    }

    /// Final flush on capture termination to commit all remaining flows and sessions.
    pub fn finish<R: CaptureRepository>(&mut self, store: &mut CaptureStore<R>) {
        let (flows, sessions) = self.engine.finish();
        for ff in flows {
            store.insert_flow(ff.flow, ff.events);
        }
        for s in sessions {
            store.insert_session(s);
        }
        for (ip, names) in self.engine.resolutions() {
            store.set_resolution(ip, names);
        }
        store.auto_evict_if_needed();
    }

    /// Final flush on capture termination to commit all remaining flows and sessions asynchronously.
    pub async fn finish_async<R: CaptureRepository>(&mut self, store: &mut CaptureStore<R>) {
        let (flows, sessions) = self.engine.finish();
        for ff in flows {
            store.insert_flow_async(ff.flow, ff.events).await;
        }
        for s in sessions {
            store.insert_session_async(s).await;
        }
        for (ip, names) in self.engine.resolutions() {
            store.set_resolution_async(ip, names).await;
        }
        store.auto_evict_if_needed();
    }
}

/// The Phase 2 presentation projection of a completed run:
/// the narrative feed and the monitoring snapshot, already in the `netpulse-api`
/// wire shapes at a chosen [`Depth`]. This is the bundle a UI receives; it is a
/// pure read-only *view* over the store, computed after the
/// pipeline has committed its reconstruction.
#[derive(Debug, Clone)]
pub struct PresentationView {
    pub narratives: Vec<NarrativeCardDto>,
    pub monitor: MonitorSnapshotDto,
}

/// Build the presentation view from a committed store at the given disclosure
/// depth. `capture_stats` carries the honest capture-drop count
/// so the monitor snapshot can keep capture loss distinct from network loss
///pass [`CaptureStats::default`] for a lossless offline run.
pub fn present<R: CaptureRepository>(
    store: &CaptureStore<R>,
    depth: Depth,
    capture_stats: CaptureStats,
) -> PresentationView {
    // --- Narrative feed: one card per session, over the store query surface ---
    // Own the flow/event clones so the borrowed SessionViews can reference them
    // for the duration of card building (: narrative is a projection
    // fed by the caller, which gathers from storage per .
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

    // --- Monitoring snapshot over the full window ---
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
    /// identical frames/timestamps.
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
        // capture live into a recording, then replay; the replayed
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
        // The determinism meta-test at the pipeline level: two
        // replays of one recording yield identical reports.
        let pcap = tiny_pcap(&[&[9, 9, 9, 9]]);
        let recording = recording_from_pcap(&pcap);
        let mut s1 = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let mut s2 = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let r1 = run_replay(&recording, 8, &mut s1).unwrap();
        let r2 = run_replay(&recording, 8, &mut s2).unwrap();
        assert_eq!(r1, r2);
    }

    #[test]
    fn live_pipeline_incremental_commit_matches() {
        let f1 = RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0xde, 0xad, 0xbe, 0xef],
        };
        let f2 = RawFrame {
            mono_nanos: 2_000_000,
            iface_id: 1,
            bytes: vec![1, 2, 3, 4, 5, 6],
        };

        let mut pipeline = LivePipeline::new(1, 8);
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);

        pipeline.ingest_batch(std::slice::from_ref(&f1));
        pipeline.commit_to_store(&mut store, f1.mono_nanos);

        pipeline.ingest_batch(std::slice::from_ref(&f2));
        pipeline.commit_to_store(&mut store, f2.mono_nanos);
        pipeline.finish(&mut store);

        let (store_offline, _) = analyze_frames(1, &[f1, f2], 8).unwrap();
        assert_eq!(store.flow_count(), store_offline.flow_count());
        assert_eq!(store.session_count(), store_offline.session_count());
    }
}
