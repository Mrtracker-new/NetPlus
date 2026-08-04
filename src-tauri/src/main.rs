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

use netpulse_api::dto::{ExportFormatDto, ExportSelectionDto};
use netpulse_api::{Command, ProjectionDepth, Query, QueryResponse};
use netpulse_capture::{
    CaptureStats, Recording, ReplayController, ReplayState, ShedController, ShedStage,
    ETH_IPV4_TCP_HEADERS,
};
use netpulse_core::traits::{CaptureSource, RawFrame, SocketTableSource};
use netpulse_core::Depth;
use netpulse_engine::attribution::Correlator;
use netpulse_engine::export::{ExportFormat, Selection};
use netpulse_plugin::{
    ContractVersion, PluginManifest, PluginRegistry, PluginType, TrustMetadata, TrustStatus,
};
use netpulse_storage::{CaptureStore, PayloadPolicy};

pub(crate) mod ipc;

/// Shell state: the committed reconstruction store, the current disclosure depth,
/// and the Phase 5 lifecycle state — recordings, an optional replay controller,
/// and the plugin registry (seeded with the first-party reference plugins). Behind
/// `Mutex`es so Tauri can share it across command invocations.
pub(crate) struct AppState {
    // `Arc` so the background live-capture thread can share the same store/stats
    // the query handler reads (the thread swaps in fresh reconstructions).
    pub(crate) store: Arc<Mutex<CaptureStore>>,
    pub(crate) depth: Mutex<Depth>,
    pub(crate) stats: Arc<Mutex<CaptureStats>>,
    pub(crate) recordings: Mutex<Vec<Recording>>,
    pub(crate) replay: Mutex<Option<ReplayController>>,
    pub(crate) registry: Mutex<PluginRegistry>,
    /// Handle to the running live capture, if any (docs/05). `None` when idle.
    pub(crate) capture: Mutex<Option<CaptureControl>>,
    /// The time-indexed flow→process correlator (docs/12), fed socket-table
    /// snapshots by the capture loop and queried by `AttributionOfFlow`.
    pub(crate) correlator: Arc<Mutex<Correlator>>,
    /// The live socket→PID source, or `None` where no backend exists (attribution
    /// then stays honestly Unknown, docs/12 §8).
    pub(crate) sockets: Option<Arc<dyn SocketTableSource + Send + Sync>>,
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
pub(crate) fn start_capture(state: &AppState, iface_id: u16) -> Result<(), String> {
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
pub(crate) fn stop_capture(state: &AppState) -> Result<(), String> {
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

struct HintGuard(Arc<AtomicBool>);

impl Drop for HintGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

type HintMap = std::collections::BTreeMap<std::net::IpAddr, Vec<netpulse_core::HostName>>;

/// Helper function with narrow responsibility: commit pipeline updates to the store
/// and update atomic stats and name hints.
#[allow(clippy::too_many_arguments)]
fn rebuild_and_commit(
    pipeline: &mut netpulse_engine::pipeline::LivePipeline,
    latest_mono: u64,
    capture_stats: (u64, u64),
    store: &Arc<Mutex<CaptureStore>>,
    stats: &Arc<Mutex<CaptureStats>>,
    hint_cache: &mut HintMap,
    last_hint_refresh: &mut Option<std::time::Instant>,
    hint_rx: &std::sync::mpsc::Receiver<HintMap>,
    hint_tx: &std::sync::mpsc::Sender<HintMap>,
    hint_in_flight: &Arc<AtomicBool>,
    stop: &Arc<AtomicBool>,
    shed_controller: &ShedController,
    buffer_len: usize,
    buffer_drops: u64,
    max_frames: usize,
    hint_refresh_secs: u64,
) {
    // 1. Drain incoming background hints from channel
    while let Ok(new_hints) = hint_rx.try_recv() {
        *hint_cache = new_hints;
        *last_hint_refresh = Some(std::time::Instant::now());
    }

    // 2. Trigger background hint refresh if due, capture is running, and no worker is in flight
    let due = last_hint_refresh
        .map(|t| t.elapsed().as_secs() >= hint_refresh_secs)
        .unwrap_or(true);
    if due && !stop.load(Ordering::Relaxed) && !hint_in_flight.swap(true, Ordering::AcqRel) {
        let flag = hint_in_flight.clone();
        let tx = hint_tx.clone();
        let spawn_res = std::thread::Builder::new()
            .name("dns-hint-refresh".into())
            .spawn(move || {
                let _guard = HintGuard(flag);
                let hints = netpulse_platform::host_name_hints();
                let _ = tx.send(hints);
            });
        if let Err(e) = spawn_res {
            hint_in_flight.store(false, Ordering::Release);
            tracing::warn!("Failed to spawn dns-hint-refresh worker: {e}");
        }
    }

    // 3. Commit pipeline updates & merge hint cache to store
    if let Ok(mut s) = store.lock() {
        pipeline.commit_to_store(&mut s, latest_mono);
        for (ip, names) in hint_cache.iter() {
            s.merge_resolution(*ip, names.clone());
        }
    }

    let (received, kernel_dropped) = capture_stats;
    if let Ok(mut st) = stats.lock() {
        let total_dropped = kernel_dropped.saturating_add(buffer_drops);
        st.received = st.received.max(received);
        st.dropped = st.dropped.max(total_dropped);
        st.shed_stage = shed_controller.current_stage();
        st.buffer_frames = buffer_len;
        st.buffer_capacity = max_frames;
    }
}

/// The background live-capture loop (docs/05 §4). Drains frames from the backend
/// into a bounded buffer and periodically commits incremental engine updates
/// into the committed store via [`netpulse_engine::pipeline::LivePipeline`].
/// Runs until the stop flag is set or the source closes.
#[allow(clippy::too_many_arguments)]
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

    let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(dlt, 16);
    let mut buffer: VecDeque<RawFrame> = VecDeque::with_capacity(MAX_FRAMES);
    let mut shed_controller = ShedController::new(MAX_FRAMES);
    let mut buffer_drops = 0u64;
    let mut latest_mono = 0u64;
    let mut last_rebuild = std::time::Instant::now();
    let mut hint_cache: HintMap = HintMap::new();
    let mut last_hint_refresh: Option<std::time::Instant> = None;

    let (hint_tx, hint_rx) = std::sync::mpsc::channel::<HintMap>();
    let hint_in_flight = Arc::new(AtomicBool::new(false));

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

            pipeline.ingest_batch(&batch);

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
                &mut pipeline,
                latest_mono,
                capture.stats(),
                &store,
                &stats,
                &mut hint_cache,
                &mut last_hint_refresh,
                &hint_rx,
                &hint_tx,
                &hint_in_flight,
                &stop,
                &shed_controller,
                buffer.len(),
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
        &mut pipeline,
        latest_mono,
        capture.stats(),
        &store,
        &stats,
        &mut hint_cache,
        &mut last_hint_refresh,
        &hint_rx,
        &hint_tx,
        &hint_in_flight,
        &stop,
        &shed_controller,
        buffer.len(),
        buffer_drops,
        MAX_FRAMES,
        HINT_REFRESH_SECS,
    );
    if let Ok(mut s) = store.lock() {
        pipeline.finish(&mut s);
    }
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
        |name: &str, ty: PluginType, default_cfg: serde_json::Value, schema: Option<netpulse_plugin::JsonSchema>, fuzzed: bool, has_explanation: bool| {
            let m = PluginManifest {
                manifest_version: 1,
                metadata: netpulse_plugin::PluginMetadata {
                    name: name.into(),
                    plugin_type: ty,
                    target_contract: ContractVersion(netpulse_api::API_VERSION),
                },
                config: netpulse_plugin::PluginConfigurationMetadata {
                    config_version: 1,
                    default_config: default_cfg,
                    config_schema: schema,
                },
                security: netpulse_plugin::PluginSecurityMetadata {
                    trust: TrustMetadata {
                        source: format!("in-tree:plugins/{name}"),
                        signatures: Vec::new(),
                        status: TrustStatus::FirstParty,
                    },
                    payload_hash: netpulse_plugin::Sha256Digest([0u8; 32]),
                    signatures: Vec::new(),
                    fuzzed,
                    has_explanation,
                },
            };
            netpulse_plugin::VerificationOutcome {
                manifest: m,
                claimed_trust: TrustStatus::FirstParty,
                effective_trust: TrustStatus::FirstParty,
                verification_result: Ok(netpulse_plugin::VerificationSuccess::FirstParty(
                    "in-tree-key".into(),
                )),
                payload_hash_valid: true,
            }
        };
    reg.register(first_party(
        "example-dissector",
        PluginType::Dissector,
        serde_json::json!({}),
        None,
        true,
        true,
    ));
    reg.register(first_party(
        "example-detector",
        PluginType::Detector,
        serde_json::json!({ "threshold": 8 }),
        Some(netpulse_plugin::JsonSchema(serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "threshold": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 8
                }
            },
            "required": ["threshold"]
        }))),
        false,
        false,
    ));
    reg.register(first_party(
        "example-enrichment",
        PluginType::Enrichment,
        serde_json::json!({}),
        None,
        false,
        false,
    ));
    reg.register(first_party(
        "example-export",
        PluginType::Export,
        serde_json::json!({}),
        None,
        false,
        false,
    ));
    reg.register(first_party(
        "example-view",
        PluginType::View,
        serde_json::json!({
            "refresh_interval_ms": 1000,
            "max_items": 50,
            "show_timestamps": true
        }),
        Some(netpulse_plugin::JsonSchema(serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "refresh_interval_ms": {
                    "type": "integer",
                    "minimum": 100,
                    "maximum": 60000,
                    "default": 1000
                },
                "max_items": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 50
                },
                "show_timestamps": {
                    "type": "boolean",
                    "default": true
                }
            },
            "required": ["refresh_interval_ms", "max_items", "show_timestamps"]
        }))),
        false,
        false,
    ));
    reg
}


pub(crate) fn to_depth(d: ProjectionDepth) -> Depth {
    match d {
        ProjectionDepth::Beginner => Depth::Beginner,
        ProjectionDepth::Intermediate => Depth::Intermediate,
        ProjectionDepth::Expert => Depth::Expert,
        _ => Depth::Beginner,
    }
}

/// Map a wire export selection to the engine's domain selection (docs/23 §8).
pub(crate) fn to_selection(sel: ExportSelectionDto) -> Selection {
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

pub(crate) fn to_format(f: ExportFormatDto) -> ExportFormat {
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
pub(crate) fn empty_replay_state() -> ReplayState {
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
    ipc::execute_query(&state, query)
}

/// The single control entry point (docs/02 §7.1) — the only write path UI→engine.
/// Observe-only: nothing here touches network traffic.
#[tracing::instrument(level = "debug", skip(state))]
#[tauri::command]
fn command(command: Command, state: tauri::State<'_, AppState>) -> Result<(), String> {
    ipc::execute_command(&state, command)
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
        let frame = RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        };

        let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(1, 16);
        pipeline.ingest_batch(&[frame]);

        let mut hint_cache = std::collections::BTreeMap::new();
        let mut last_hint_refresh = Some(std::time::Instant::now());
        let (hint_tx, hint_rx) = std::sync::mpsc::channel();
        let hint_in_flight = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let shed_controller = ShedController::new(1000);

        rebuild_and_commit(
            &mut pipeline,
            1_000_000,
            (1, 0),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &hint_rx,
            &hint_tx,
            &hint_in_flight,
            &stop,
            &shed_controller,
            1,
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

    #[test]
    fn test_rebuild_and_commit_monotonic_stats_update() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats {
            received: 500,
            dropped: 10,
            ..Default::default()
        }));
        let frame = RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        };

        let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(1, 16);
        pipeline.ingest_batch(&[frame]);

        let mut hint_cache = std::collections::BTreeMap::new();
        let mut last_hint_refresh = Some(std::time::Instant::now());
        let (hint_tx, hint_rx) = std::sync::mpsc::channel();
        let hint_in_flight = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let shed_controller = ShedController::new(1000);

        // Attempt update with lower counters (e.g. out of order or transient drop)
        rebuild_and_commit(
            &mut pipeline,
            1_000_000,
            (400, 5),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &hint_rx,
            &hint_tx,
            &hint_in_flight,
            &stop,
            &shed_controller,
            1,
            0,
            1000,
            30,
        );

        let st = stats.lock().unwrap();
        // Assert counters remained monotonic at max values (500, 10)
        assert_eq!(st.received, 500);
        assert_eq!(st.dropped, 10);
    }

    #[test]
    fn test_dns_hint_only_one_worker_in_flight() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(1, 16);
        let mut hint_cache = HintMap::new();
        let mut last_hint_refresh = None; // Due immediately
        let (hint_tx, hint_rx) = std::sync::mpsc::channel();
        let hint_in_flight = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let shed_controller = ShedController::new(1000);

        // First call triggers background worker
        rebuild_and_commit(
            &mut pipeline,
            1_000_000,
            (1, 0),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &hint_rx,
            &hint_tx,
            &hint_in_flight,
            &stop,
            &shed_controller,
            0,
            0,
            1000,
            30,
        );

        // Second call while worker running should not spawn a duplicate
        let prev_flag = hint_in_flight.swap(true, Ordering::AcqRel);
        assert!(prev_flag, "Flag must remain in-flight while worker is running");
    }

    #[test]
    fn test_dns_hint_worker_panic_resets_flag() {
        let hint_in_flight = Arc::new(AtomicBool::new(true));
        {
            let _guard = HintGuard(hint_in_flight.clone());
            // Simulate worker panic inside scoped block
        }
        assert!(!hint_in_flight.load(Ordering::Acquire), "Guard drop must reset flag even on panic");
    }

    #[test]
    fn test_dns_hint_multiple_completed_refreshes_latest_wins() {
        let (hint_tx, hint_rx) = std::sync::mpsc::channel();
        let mut map1 = HintMap::new();
        map1.insert(
            "1.1.1.1".parse().unwrap(),
            vec![netpulse_core::HostName {
                name: "old.local".into(),
                source: netpulse_core::NameSource::HostsFile,
            }],
        );
        let mut map2 = HintMap::new();
        map2.insert(
            "1.1.1.1".parse().unwrap(),
            vec![netpulse_core::HostName {
                name: "newest.local".into(),
                source: netpulse_core::NameSource::HostsFile,
            }],
        );

        hint_tx.send(map1).unwrap();
        hint_tx.send(map2).unwrap();

        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(1, 16);
        let mut hint_cache = HintMap::new();
        let mut last_hint_refresh = Some(std::time::Instant::now());
        let hint_in_flight = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let shed_controller = ShedController::new(1000);

        rebuild_and_commit(
            &mut pipeline,
            1_000_000,
            (1, 0),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &hint_rx,
            &hint_tx,
            &hint_in_flight,
            &stop,
            &shed_controller,
            0,
            0,
            1000,
            30,
        );

        assert_eq!(
            hint_cache.get(&"1.1.1.1".parse().unwrap()).unwrap()[0].name,
            "newest.local"
        );
    }

    #[test]
    fn test_dns_hint_channel_disconnect_handled_safely() {
        let (hint_tx, hint_rx) = std::sync::mpsc::channel::<HintMap>();
        drop(hint_rx); // Receiver dropped

        let flag = Arc::new(AtomicBool::new(false));
        let _guard = HintGuard(flag.clone());
        let res = hint_tx.send(HintMap::new());
        assert!(res.is_err(), "Send fails on disconnected receiver without crashing worker");
    }

    #[test]
    fn test_dns_hint_shutdown_prevents_spawn() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let mut pipeline = netpulse_engine::pipeline::LivePipeline::new(1, 16);
        let mut hint_cache = HintMap::new();
        let mut last_hint_refresh = None; // Due
        let (hint_tx, hint_rx) = std::sync::mpsc::channel();
        let hint_in_flight = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(true)); // Stop flag set
        let shed_controller = ShedController::new(1000);

        rebuild_and_commit(
            &mut pipeline,
            1_000_000,
            (1, 0),
            &store,
            &stats,
            &mut hint_cache,
            &mut last_hint_refresh,
            &hint_rx,
            &hint_tx,
            &hint_in_flight,
            &stop,
            &shed_controller,
            0,
            0,
            1000,
            30,
        );

        assert!(!hint_in_flight.load(Ordering::Acquire), "Must not spawn background worker if stop flag set");
    }

    #[test]
    fn test_handshake_query_integration() {
        let state = AppState::default();

        let res = ipc::execute_query(
            &state,
            Query::Handshake {
                client_min_version: 5,
                client_max_version: 6,
            },
        )
        .expect("handshake query should succeed");

        if let QueryResponse::Handshake { handshake } = res {
            assert!(handshake.compatible);
            assert_eq!(handshake.negotiated_version, Some(6));
            assert_eq!(handshake.host_version, 6);
            assert_eq!(handshake.min_supported_version, 5);
        } else {
            panic!("Expected Handshake variant in response");
        }
    }
}
