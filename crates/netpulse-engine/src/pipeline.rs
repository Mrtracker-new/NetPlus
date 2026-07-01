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

use netpulse_capture::FileCapture;
use netpulse_core::traits::CaptureSource;
use netpulse_core::{Session, Timestamp};
use netpulse_decode::decode_frame;
use netpulse_flow::{FlowEngine, PacketView};
use netpulse_storage::{CaptureStore, PayloadPolicy};

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
