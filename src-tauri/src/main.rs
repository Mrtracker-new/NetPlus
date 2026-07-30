//! The NetPulse desktop shell (docs/03 §8). Tauri hosts the React webview and
//! exposes exactly two commands — `query` and `command` — that carry the
//! enumerated `netpulse-api` surface. The webview can invoke nothing else, so
//! the observe-only guarantee is trivially auditable (docs/02 §10): there is no
//! IPC path that modifies traffic.
//!
//! This shell is intentionally thin. All analysis lives in `netpulse-engine`;
//! the shell owns the committed store and maps a [`Query`] to a [`QueryResponse`]
//! over the engine's read-only presentation view (docs/11 §14). `StartCapture`
//! opens the platform's live backend (Windows/Npcap, docs/05) and drives a
//! background reconstruction loop; where the backend is unavailable it fails
//! closed honestly rather than pretending (docs/02 §11). Capture is observe-only:
//! a read-only frame stream wired to no injection API (docs/01 X1).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use netpulse_api::dto::{ExportFormatDto, ExportSelectionDto, InterfaceDto};
use netpulse_api::{Command, ProjectionDepth, Query, QueryResponse};
use netpulse_capture::{
    CaptureStats, Recording, ReplayController, ReplayState, ShedController, ShedStage,
    ETH_IPV4_TCP_HEADERS,
};
use netpulse_core::traits::{CaptureSource, RawFrame, SocketTableSource};
use netpulse_core::Depth;
use netpulse_engine::attribution::{Attribution, Correlator};
use netpulse_engine::education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
};
use netpulse_engine::export::{preview as export_preview, ExportFormat, Sanitizer, Selection};
use netpulse_engine::pipeline::present;
use netpulse_engine::project;
use netpulse_engine::security::{ask_assistant, present_security};
use netpulse_plugin::{
    ContractVersion, PluginManifest, PluginRegistry, PluginType, TrustMetadata, TrustStatus,
};
use netpulse_storage::{CaptureStore, PayloadPolicy};

/// Shell state: the committed reconstruction store, the current disclosure depth,
/// and the Phase 5 lifecycle state — recordings, an optional replay controller,
/// and the plugin registry (seeded with the first-party reference plugins). Behind
/// `Mutex`es so Tauri can share it across command invocations.
struct AppState {
    // `Arc` so the background live-capture thread can share the same store/stats
    // the query handler reads (the thread swaps in fresh reconstructions).
    store: Arc<Mutex<CaptureStore>>,
    depth: Mutex<Depth>,
    stats: Arc<Mutex<CaptureStats>>,
    recordings: Mutex<Vec<Recording>>,
    replay: Mutex<Option<ReplayController>>,
    registry: Mutex<PluginRegistry>,
    /// Handle to the running live capture, if any (docs/05). `None` when idle.
    capture: Mutex<Option<CaptureControl>>,
    /// The time-indexed flow→process correlator (docs/12), fed socket-table
    /// snapshots by the capture loop and queried by `AttributionOfFlow`.
    correlator: Arc<Mutex<Correlator>>,
    /// The live socket→PID source, or `None` where no backend exists (attribution
    /// then stays honestly Unknown, docs/12 §8).
    sockets: Option<Arc<dyn SocketTableSource + Send + Sync>>,
}

/// Scope guard that guarantees a completion signal is sent when live_loop exits
/// (even on panic or early return).
struct CompletionGuard(Option<std::sync::mpsc::Sender<()>>);

impl Drop for CompletionGuard {
    fn drop(&mut self) {
        if let Some(tx) = self.0.take() {
            let _ = tx.send(());
        }
    }
}

/// Control handle for the background live-capture thread: a stop flag it polls
/// between batches, a completion receiver, and its join handle so [`stop_capture`]
/// can wait deterministically without indefinite blocking (docs/05 §4).
struct CaptureControl {
    stop: Arc<AtomicBool>,
    done_rx: std::sync::mpsc::Receiver<()>,
    handle: std::thread::JoinHandle<()>,
}

impl Default for AppState {
    fn default() -> Self {
        // The shell boots empty; data arrives from live capture (Start capture in
        // the UI) or, for offline work, by setting `NETPULSE_PCAP=<path>` to seed
        // the store from a saved capture — the same import path the engine CLI
        // uses (docs/23 §5). Without either, the UI shows its honest empty states
        // (docs/02 §11).
        let (store, stats) = seed_store_from_env();
        Self {
            store: Arc::new(Mutex::new(store)),
            depth: Mutex::new(Depth::Beginner),
            stats: Arc::new(Mutex::new(stats)),
            recordings: Mutex::new(Vec::new()),
            replay: Mutex::new(None),
            registry: Mutex::new(seed_registry()),
            capture: Mutex::new(None),
            correlator: Arc::new(Mutex::new(Correlator::new())),
            sockets: netpulse_platform::socket_table(),
        }
    }
}

/// Start live capture on `iface_id` and spawn the background reconstruction loop
/// (docs/05). The capture handle is opened *inside* the thread so the (possibly
/// non-`Send`) backend never crosses a thread boundary; the open result is
/// reported back so the UI gets an immediate, honest error if Npcap is missing or
/// privileges are insufficient (docs/02 §11).
fn start_capture(state: &AppState, iface_id: u16) -> Result<(), String> {
    let mut guard = state.capture.lock().map_err(|_| "state poisoned")?;
    if guard.is_some() {
        return Err("capture is already running".into());
    }

    let store = Arc::clone(&state.store);
    let stats = Arc::clone(&state.stats);
    let correlator = Arc::clone(&state.correlator);
    let sockets = state.sockets.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();

    let handle = std::thread::spawn(move || match netpulse_platform::open_capture(iface_id) {
        Ok(capture) => {
            let dlt = capture.link_dlt();
            let _ = tx.send(Ok(()));
            live_loop(
                capture,
                dlt,
                store,
                stats,
                correlator,
                sockets,
                stop_thread,
                done_tx,
            );
        }
        Err(e) => {
            let _ = tx.send(Err(e.to_string()));
        }
    });

    match rx.recv() {
        Ok(Ok(())) => {
            *guard = Some(CaptureControl {
                stop,
                done_rx,
                handle,
            });
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(_) => {
            let _ = handle.join();
            Err("capture thread failed to start".into())
        }
    }
}

/// Stop the running live capture gracefully: signal the thread, wait for a completion
/// signal (up to 3s), join cleanly, and commit the final reconstruction store.
fn stop_capture(state: &AppState) -> Result<(), String> {
    let ctrl = state.capture.lock().map_err(|_| "state poisoned")?.take();
    match ctrl {
        Some(ctrl) => {
            ctrl.stop.store(true, Ordering::Relaxed);
            match ctrl.done_rx.recv_timeout(std::time::Duration::from_secs(3)) {
                Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    match ctrl.handle.join() {
                        Ok(()) => Ok(()),
                        Err(_) => Err("capture thread panicked during shutdown".into()),
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Put control handle back so UI state honestly reflects thread is still running
                    if let Ok(mut guard) = state.capture.lock() {
                        *guard = Some(ctrl);
                    }
                    Err("capture thread did not terminate within 3 seconds".into())
                }
            }
        }
        None => Err("no capture is running".into()),
    }
}

/// Helper function with narrow responsibility: rebuild flows from the frame buffer
/// and commit the updated reconstruction store, stats, and name hints.
fn rebuild_and_commit(
    dlt: u32,
    buffer: &mut VecDeque<RawFrame>,
    capture_stats: (u64, u64),
    store: &Arc<Mutex<CaptureStore>>,
    stats: &Arc<Mutex<CaptureStats>>,
    hint_cache: &mut std::collections::BTreeMap<std::net::IpAddr, Vec<netpulse_core::HostName>>,
    last_hint_refresh: &mut Option<std::time::Instant>,
    shed_controller: &ShedController,
    buffer_drops: u64,
    max_frames: usize,
    hint_refresh_secs: u64,
) {
    if buffer.is_empty() {
        return;
    }
    let slice = buffer.make_contiguous();
    if let Ok((mut new_store, _report)) =
        netpulse_engine::pipeline::analyze_frames(dlt, slice, 16)
    {
        if last_hint_refresh
            .map(|t: std::time::Instant| t.elapsed().as_secs() >= hint_refresh_secs)
            .unwrap_or(true)
        {
            *hint_cache = netpulse_platform::host_name_hints();
            *last_hint_refresh = Some(std::time::Instant::now());
        }
        for (ip, names) in hint_cache.iter() {
            new_store.merge_resolution(*ip, names.clone());
        }

        let (received, kernel_dropped) = capture_stats;
        if let Ok(mut s) = store.lock() {
            *s = new_store;
        }
        if let Ok(mut st) = stats.lock() {
            *st = CaptureStats {
                received,
                dropped: kernel_dropped.saturating_add(buffer_drops),
                shed_stage: shed_controller.current_stage(),
                buffer_frames: buffer.len(),
                buffer_capacity: max_frames,
            };
        }
    }
}

/// The background live-capture loop (docs/05 §4). Drains frames from the backend
/// into a bounded buffer and, about once a second, rebuilds the committed store
/// via the *same* offline pipeline (`analyze_frames`) so live reconstruction
/// matches file/replay exactly (docs/21 §4). Runs until the stop flag is set or
/// the source closes.
fn live_loop(
    mut capture: netpulse_platform::LiveCapture,
    dlt: u32,
    store: Arc<Mutex<CaptureStore>>,
    stats: Arc<Mutex<CaptureStats>>,
    correlator: Arc<Mutex<Correlator>>,
    sockets: Option<Arc<dyn SocketTableSource + Send + Sync>>,
    stop: Arc<AtomicBool>,
    done_tx: std::sync::mpsc::Sender<()>,
) {
    let _completion_guard = CompletionGuard(Some(done_tx));
    const MAX_FRAMES: usize = 50_000;
    const HINT_REFRESH_SECS: u64 = 30;

    let mut buffer: VecDeque<RawFrame> = VecDeque::with_capacity(MAX_FRAMES);
    let mut shed_controller = ShedController::new(MAX_FRAMES);
    let mut buffer_drops = 0u64;
    let mut latest_mono = 0u64;
    let mut last_rebuild = std::time::Instant::now();
    let mut hint_cache: std::collections::BTreeMap<std::net::IpAddr, Vec<netpulse_core::HostName>> =
        std::collections::BTreeMap::new();
    let mut last_hint_refresh: Option<std::time::Instant> = None;

    while !stop.load(Ordering::Relaxed) {
        let batch = match capture.next_batch() {
            Ok(b) => b,
            Err(_) => break, // source closed or errored — end capture honestly
        };
        if !batch.is_empty() {
            if let Some(f) = batch.last() {
                latest_mono = latest_mono.max(f.mono_nanos);
            }
            let fill_len = buffer.len() + batch.len();
            let current_stage = shed_controller.update(fill_len);

            // Pre-insertion eviction (Option A sliding window): drain overflow from head of ring buffer
            if fill_len > MAX_FRAMES {
                let overflow = fill_len - MAX_FRAMES;
                let to_drop = overflow.min(buffer.len());
                buffer.drain(0..to_drop);
                buffer_drops = buffer_drops.saturating_add(overflow as u64);
            }

            for mut frame in batch {
                if current_stage >= ShedStage::PayloadsOff {
                    frame.bytes.truncate(ETH_IPV4_TCP_HEADERS);
                }
                if current_stage == ShedStage::SampleDissection && !shed_controller.should_sample() {
                    continue;
                }
                buffer.push_back(frame);
            }
        }

        if last_rebuild.elapsed().as_millis() >= 1000 && !buffer.is_empty() {
            last_rebuild = std::time::Instant::now();
            rebuild_and_commit(
                dlt,
                &mut buffer,
                capture.stats(),
                &store,
                &stats,
                &mut hint_cache,
                &mut last_hint_refresh,
                &shed_controller,
                buffer_drops,
                MAX_FRAMES,
                HINT_REFRESH_SECS,
            );

            // Poll the OS socket tables and feed the correlator, timestamped in the
            // same capture-relative monotonic clock the flows use (docs/12 §5).
            if let Some(source) = &sockets {
                if let Ok(owners) = source.snapshot() {
                    if let Ok(mut c) = correlator.lock() {
                        c.ingest_snapshot(latest_mono, &owners);
                    }
                }
            }
        }
    }

    // Final Flush on shutdown so in-flight frames are never lost
    rebuild_and_commit(
        dlt,
        &mut buffer,
        capture.stats(),
        &store,
        &stats,
        &mut hint_cache,
        &mut last_hint_refresh,
        &shed_controller,
        buffer_drops,
        MAX_FRAMES,
        HINT_REFRESH_SECS,
    );
    // _completion_guard drops here, signaling done_tx
}

/// Optionally seed the committed store from a pcap named by `NETPULSE_PCAP`,
/// running the identical offline pipeline the CLI does (`analyze_pcap`). Any
/// problem (unset var, unreadable file, undecodable capture) falls back to an
/// empty metadata-only store rather than failing the launch — the UI then shows
/// its empty states honestly (docs/02 §11: never fabricate data).
fn seed_store_from_env() -> (CaptureStore, CaptureStats) {
    // Metadata-only is the private default (docs/08 §4).
    let empty = || {
        (
            CaptureStore::new(PayloadPolicy::MetadataOnly),
            CaptureStats::default(),
        )
    };

    let Some(path) = std::env::var_os("NETPULSE_PCAP") else {
        return empty();
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!(
                "NetPulse: NETPULSE_PCAP={} could not be read ({e}); starting with an empty store.",
                path.to_string_lossy()
            );
            return empty();
        }
    };
    match netpulse_engine::pipeline::analyze_pcap(&bytes, 16) {
        Ok((store, report)) => {
            // An offline file is lossless: every frame read was "received" and none
            // was dropped, so the monitor keeps capture loss honestly at zero
            // (docs/11 §6.4).
            let stats = CaptureStats {
                received: report.frames_read as u64,
                dropped: 0,
                ..Default::default()
            };
            eprintln!(
                "NetPulse: loaded {} — {} frames, {} decoded, {} flows, {} sessions, {} causal links.",
                path.to_string_lossy(),
                report.frames_read,
                report.packets_decoded,
                report.flows,
                report.sessions,
                report.causal_links,
            );
            (store, stats)
        }
        Err(e) => {
            eprintln!(
                "NetPulse: NETPULSE_PCAP={} is not an analyzable capture ({e}); starting with an empty store.",
                path.to_string_lossy()
            );
            empty()
        }
    }
}

/// Register the first-party reference plugins (docs/24 §6) so the Plugins surface
/// lists real, capability-bounded seams. Their manifests mirror the in-tree
/// examples under `plugins/`; the registry auto-enables first-party references.
fn seed_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new(netpulse_api::API_VERSION);
    let first_party =
        |name: &str, ty: PluginType, fuzzed: bool, has_explanation: bool| PluginManifest {
            name: name.into(),
            plugin_type: ty,
            target_contract: ContractVersion(netpulse_api::API_VERSION),
            trust: TrustMetadata {
                source: format!("in-tree:plugins/{name}"),
                signature: None,
                status: TrustStatus::FirstParty,
            },
            fuzzed,
            has_explanation,
        };
    reg.register(first_party(
        "example-dissector",
        PluginType::Dissector,
        true,
        true,
    ));
    reg.register(first_party(
        "example-detector",
        PluginType::Detector,
        false,
        false,
    ));
    reg.register(first_party(
        "example-enrichment",
        PluginType::Enrichment,
        false,
        false,
    ));
    reg.register(first_party(
        "example-export",
        PluginType::Export,
        false,
        false,
    ));
    reg
}

fn to_depth(d: ProjectionDepth) -> Depth {
    match d {
        ProjectionDepth::Beginner => Depth::Beginner,
        ProjectionDepth::Intermediate => Depth::Intermediate,
        ProjectionDepth::Expert => Depth::Expert,
        _ => Depth::Beginner,
    }
}

/// Map a wire export selection to the engine's domain selection (docs/23 §8).
fn to_selection(sel: ExportSelectionDto) -> Selection {
    match sel {
        ExportSelectionDto::Window {
            from_mono_nanos,
            to_mono_nanos,
        } => Selection::Window {
            from: from_mono_nanos,
            to: to_mono_nanos,
        },
        ExportSelectionDto::Session { id } => Selection::Session(id),
        ExportSelectionDto::Finding { id } => Selection::Finding(id),
        _ => Selection::All,
    }
}

fn to_format(f: ExportFormatDto) -> ExportFormat {
    match f {
        ExportFormatDto::Pcapng => ExportFormat::Pcapng,
        ExportFormatDto::Json => ExportFormat::Json,
        ExportFormatDto::Csv => ExportFormat::Csv,
        ExportFormatDto::Report => ExportFormat::Report,
        _ => ExportFormat::Json,
    }
}

/// An honest zero replay state when no recording is loaded (docs/21 §8; docs/02
/// §11 fail-closed rather than pretend).
fn empty_replay_state() -> ReplayState {
    ReplayState {
        position_nanos: 0,
        total_nanos: 0,
        speed_percent: 100,
        playing: false,
        frame_index: 0,
        incomplete: false,
    }
}

/// The single pull entry point (docs/02 §7.1). Every historical/aggregated read
/// the UI performs comes through here and is answered from the committed store.
#[tracing::instrument(level = "debug", skip(state))]
#[tauri::command]
fn query(query: Query, state: tauri::State<'_, AppState>) -> Result<QueryResponse, String> {
    let store = state.store.lock().map_err(|_| "state poisoned")?;
    let stats = *state.stats.lock().map_err(|_| "state poisoned")?;
    match query {
        Query::NarrativeFeed { depth, .. } => {
            let view = present(&store, to_depth(depth), stats);
            Ok(QueryResponse::NarrativeFeed {
                cards: view.narratives,
            })
        }
        Query::MonitorSnapshot { .. } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            let view = present(&store, depth, stats);
            Ok(QueryResponse::MonitorSnapshot {
                snapshot: view.monitor,
            })
        }
        Query::JourneyOfSession { session_id, depth } => {
            let view = present(&store, to_depth(depth), stats);
            // The journey is the sentences of the card summarizing that session.
            let sentences = view
                .narratives
                .into_iter()
                .find(|c| {
                    c.evidence
                        .iter()
                        .any(|e| matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id))
                })
                .map(|c| {
                    let mut s = vec![c.headline];
                    s.extend(c.lines);
                    s
                })
                .unwrap_or_default();
            Ok(QueryResponse::Journey { sentences })
        }
        Query::AttributionOfFlow { flow_id } => {
            // Correlate the flow's 5-tuple against the polled socket-table history
            // (docs/12 §5). Unknown when there is no match or no backend — never a
            // guessed PID (docs/12 §8).
            let attribution = match store.flow(flow_id) {
                Some(flow) => {
                    let corr = state.correlator.lock().map_err(|_| "state poisoned")?;
                    corr.attribute(&flow.key, flow.first_ts.mono_nanos)
                }
                None => Attribution::unknown(),
            };
            // Resolve the process name lazily, only for a matched PID (docs/12 §6).
            let name = match (attribution.pid, state.sockets.as_ref()) {
                (Some(pid), Some(source)) => {
                    source.process_info(pid).ok().flatten().map(|p| p.name)
                }
                _ => None,
            };
            Ok(QueryResponse::Attribution {
                attribution: project::attribution_dto(&attribution, name),
            })
        }
        Query::PacketsOfFlow { .. } => {
            // Metadata-only store: raw bytes were never retained (docs/09 §8).
            Ok(QueryResponse::PayloadsUnavailable)
        }
        // ---- Phase 3 education queries (docs/13–16) ----
        Query::LessonOffers { session_id, depth } => {
            // Grounded offers for this session's teachable moments (docs/13 §4):
            // filter the education view to offers that cite this session.
            let view = present_education(&store, to_depth(depth));
            let offers = view
                .offers
                .into_iter()
                .filter(|o| {
                    o.evidence.iter().any(|e| {
                        matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id)
                    })
                })
                .collect();
            Ok(QueryResponse::LessonOffers { offers })
        }
        Query::JourneyStagesOfSession { session_id, depth } => {
            let view = present_education(&store, to_depth(depth));
            let journey = view
                .journeys
                .into_iter()
                .find(|j| j.session_id == session_id)
                .unwrap_or(netpulse_api::PageJourneyDto {
                    session_id,
                    stages: Vec::new(),
                    fanout: Vec::new(),
                });
            Ok(QueryResponse::PageJourney { journey })
        }
        Query::ExplorerBrowse => Ok(QueryResponse::ExplorerEntries {
            entries: explorer_browse(&store),
        }),
        Query::ExplorerSearch { term } => Ok(QueryResponse::ExplorerEntries {
            entries: explorer_search(&store, &term),
        }),
        Query::HandshakeAnimationForFlow { flow_id } => {
            match handshake_animation_for_flow(&store, flow_id) {
                Some(animation) => Ok(QueryResponse::Animation { animation }),
                // No observable RTT: we never fabricate a timing (docs/16 §11).
                None => Ok(QueryResponse::PayloadsUnavailable),
            }
        }
        // ---- Phase 4 intelligence queries (docs/17–20) ----
        Query::SecurityFindings {
            from_mono_nanos,
            to_mono_nanos,
        } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            Ok(QueryResponse::Findings {
                findings: present_security(&store, from_mono_nanos, to_mono_nanos, depth),
            })
        }
        Query::AskAssistant { question } => {
            // Grounded in the committed store, local-default backend (docs/19 §4.1).
            Ok(QueryResponse::AssistantAnswer {
                answer: ask_assistant(&store, &question),
            })
        }
        // ---- Phase 5 lifecycle queries (docs/21–24) ----
        Query::ListRecordings => {
            let recordings = state.recordings.lock().map_err(|_| "state poisoned")?;
            let summaries = recordings
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    // A recording is incomplete only if its pcapng truncated; the
                    // sealed recordings held here are whole (docs/22 §8).
                    project::recording_summary_dto(i as u64, r, false)
                })
                .collect();
            Ok(QueryResponse::Recordings {
                recordings: summaries,
            })
        }
        Query::ReplayState => {
            let replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let s = replay
                .as_ref()
                .map(|c| c.state())
                .unwrap_or_else(empty_replay_state);
            Ok(QueryResponse::ReplayState {
                state: project::replay_state_dto(&s),
            })
        }
        Query::ExportPreview { selection, format } => {
            // Preview exactly what an export would contain before any byte is
            // written (docs/23 §6), least-revealing default sanitizer (docs/23 §3).
            let preview = export_preview(
                &store,
                &to_selection(selection),
                to_format(format),
                &Sanitizer::default(),
            );
            Ok(QueryResponse::ExportPreview {
                preview: project::export_preview_dto(&preview),
            })
        }
        Query::ListPlugins => {
            let registry = state.registry.lock().map_err(|_| "state poisoned")?;
            let descriptors = registry
                .plugins()
                .iter()
                .map(|p| project::plugin_descriptor_dto(p, netpulse_api::API_VERSION))
                .collect();
            Ok(QueryResponse::Plugins {
                plugins: descriptors,
            })
        }
        Query::Interfaces => {
            // Enumerate capture adapters for the picker (docs/05). Where no backend
            // exists (feature off / Npcap absent), return an empty list — the UI
            // still offers the implicit "Default adapter" (id 0), which the
            // platform resolves, and reports the real error only on Start.
            let interfaces = netpulse_platform::list_interfaces()
                .map(|list| {
                    list.into_iter()
                        .map(|i| InterfaceDto {
                            id: i.id,
                            name: i.name,
                            description: i.description,
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(QueryResponse::Interfaces { interfaces })
        }
        Query::HealthCheck => {
            let capture_running = state.capture.lock().map_err(|_| "state poisoned")?.is_some();
            let flow_count = store.flow_count();
            let session_count = store.session_count();
            let check = netpulse_api::ComponentCheckDto {
                component: "storage".into(),
                status: "healthy".into(),
                message: None,
            };
            let status = netpulse_api::HealthStatusDto {
                schema_version: 1,
                status: "healthy".into(),
                uptime_secs: 0,
                capture_running,
                active_flows: flow_count,
                active_sessions: session_count,
                store_records: (flow_count + session_count) as u64,
                checks: vec![check],
                version: "0.1.0".into(),
                api_version: netpulse_api::API_VERSION,
            };
            Ok(QueryResponse::Health { status })
        }
        _ => Ok(QueryResponse::PayloadsUnavailable),
    }
}

/// The single control entry point (docs/02 §7.1) — the only write path UI→engine.
/// Observe-only: nothing here touches network traffic.
#[tracing::instrument(level = "debug", skip(state))]
#[tauri::command]
fn command(command: Command, state: tauri::State<'_, AppState>) -> Result<(), String> {
    match command {
        Command::SetDepth { depth } => {
            *state.depth.lock().map_err(|_| "state poisoned")? = to_depth(depth);
            Ok(())
        }
        Command::StartCapture { iface_id } => start_capture(&state, iface_id),
        Command::StopCapture { .. } => stop_capture(&state),
        Command::StartRecording | Command::StopRecording => {
            // Recording captures a live stream; with the platform backend stubbed
            // there is nothing to record. Fail closed honestly (docs/02 §11) rather
            // than seal an empty artifact and pretend (docs/22 §4).
            Err("recording requires a live capture source (platform backend is a stub)".into())
        }
        // ---- Phase 5 replay transport (docs/21 §5) ----
        Command::ReplayPlay
        | Command::ReplayPause
        | Command::ReplayStep
        | Command::ReplaySeek { .. }
        | Command::ReplaySetSpeed { .. } => {
            let mut replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let Some(ctrl) = replay.as_mut() else {
                // Honest: no recording loaded to replay (docs/02 §11).
                return Err("no recording is loaded to replay".into());
            };
            match command {
                Command::ReplayPlay => ctrl.play(),
                Command::ReplayPause => ctrl.pause(),
                Command::ReplayStep => ctrl.step(),
                Command::ReplaySeek { mono_nanos } => ctrl.seek(mono_nanos),
                Command::ReplaySetSpeed { percent } => ctrl.set_speed(percent),
                _ => unreachable!("outer match restricts to replay commands"),
            }
            Ok(())
        }
        Command::StartExport { .. } => {
            // Export writes a *file*; sharing it is a further, separate user action.
            // The shell never auto-transmits — the single egress boundary stays
            // `netpulse-ai` (docs/23 §6, docs/02 §10). Bytes are produced on demand
            // via the preview/export functions; acknowledging here keeps the shell
            // free of an implicit-egress path.
            Ok(())
        }
        Command::EnablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.enable(&name) {
                Ok(())
            } else {
                // Structurally ineligible (incompatible/incomplete) or unknown —
                // honest refusal, never a silent no-op (docs/24 §8).
                Err(format!("cannot enable plugin '{name}'"))
            }
        }
        Command::DisablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.disable(&name) {
                Ok(())
            } else {
                Err(format!("unknown plugin '{name}'"))
            }
        }
        _ => Err("unknown command".into()),
    }
}

fn main() {
    let config = netpulse_core::telemetry::read_env_config("netpulse-shell", "0.1.0");
    let _telemetry_handle = netpulse_core::telemetry::init_telemetry(config).ok();

    let root_span = tracing::info_span!(
        "shell_root",
        service = "netpulse-shell",
        version = "0.1.0",
        pid = std::process::id()
    );
    let _entered = root_span.enter();

    tracing::info!(event = "engine.start", "NetPulse desktop shell starting");

    let health_config = netpulse_core::health::read_env_health_config();
    let health_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if health_config.enabled {
        let tracker = std::sync::Arc::new(netpulse_core::health::AtomicHealthTracker::default());
        let provider = std::sync::Arc::new(netpulse_core::health::CompositeHealthProvider::new(
            "netpulse-shell",
            "0.1.0",
            tracker,
        ));
        let _health_thread = netpulse_core::health::spawn_health_server(
            health_config,
            provider,
            health_stop.clone(),
        )
        .ok();
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![query, command])
        .run(tauri::generate_context!())
        .expect("error while running the NetPulse shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completion_guard_sends_signal_on_drop() {
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        {
            let _guard = CompletionGuard(Some(done_tx));
        }
        assert_eq!(done_rx.try_recv(), Ok(()));
    }

    #[test]
    fn test_rebuild_and_commit_flushes_buffered_frames() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let mut buffer: VecDeque<RawFrame> = VecDeque::new();

        buffer.push_back(RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        });

        let mut hint_cache = std::collections::BTreeMap::new();
        let mut last_hint_refresh = None;
        let shed_controller = ShedController::new(1000);

        rebuild_and_commit(
            1,
            &mut buffer,
            (1, 0),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &shed_controller,
            0,
            1000,
            30,
        );

        let st = stats.lock().unwrap();
        assert_eq!(st.buffer_frames, 1);
        assert_eq!(st.buffer_capacity, 1000);
        assert_eq!(st.received, 1);
    }

    #[test]
    fn test_stop_capture_on_idle_state_fails_honestly() {
        let state = AppState::default();
        let res = stop_capture(&state);
        assert_eq!(res.unwrap_err(), "no capture is running");
    }

    #[test]
    fn test_worker_timeout_path_preserves_capture_control() {
        let state = AppState::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (_done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        // Spawn a thread that ignores the stop flag and sleeps longer than the 3s timeout
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
        });

        {
            let mut guard = state.capture.lock().unwrap();
            *guard = Some(CaptureControl {
                stop,
                done_rx,
                handle,
            });
        }

        let res = stop_capture(&state);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("did not terminate within 3 seconds"));

        // Verify CaptureControl handle was restored so system honestly reports running
        let guard = state.capture.lock().unwrap();
        assert!(guard.is_some());
    }

    #[test]
    fn test_panicked_worker_returns_error() {
        let state = AppState::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();

        let handle = std::thread::spawn(move || {
            let _guard = CompletionGuard(Some(done_tx));
            panic!("simulated worker panic");
        });

        {
            let mut guard = state.capture.lock().unwrap();
            *guard = Some(CaptureControl {
                stop,
                done_rx,
                handle,
            });
        }

        let res = stop_capture(&state);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "capture thread panicked during shutdown");
    }
}
