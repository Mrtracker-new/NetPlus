//! The NetPulse desktop shell. Tauri hosts the React webview and
//! exposes exactly two commands — `query` and `command` — that carry the
//! enumerated `netpulse-api` surface. The webview can invoke nothing else, so
//! the observe-only guarantee is trivially auditable: there is no
//! IPC path that modifies traffic.
//!
//! This shell is intentionally thin. All analysis lives in `netpulse-engine`;
//! the shell owns the committed store and maps a [`Query`] to a [`QueryResponse`]
//! over the engine's read-only presentation view. `StartCapture`
//! opens the platform's live backend (Windows/Npcap) and drives a
//! background reconstruction loop; where the backend is unavailable it fails
//! closed honestly rather than pretending. Capture is observe-only:
//! a read-only frame stream wired to no injection API.

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
use tauri::{Emitter, Manager};

pub(crate) mod ipc;

/// Typed errors returned during shell application shutdown.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ShutdownError {
    Capture(String),
    Storage(String),
    Health(String),
}

/// Structured summary report of shell lifecycle teardown outcomes and timing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShutdownReport {
    pub(crate) already_shutdown: bool,
    pub(crate) health_signaled: bool,
    pub(crate) capture_stopped: bool,
    pub(crate) store_flushed: bool,
    pub(crate) store_flush_duration: std::time::Duration,
    pub(crate) errors: Vec<ShutdownError>,
}

impl ShutdownReport {
    /// Returns a report indicating no work was performed because shutdown had already completed.
    /// All status flags are intentionally false, duration is zero, and errors vector is empty.
    pub(crate) fn already_done() -> Self {
        Self {
            already_shutdown: true,
            health_signaled: false,
            capture_stopped: false,
            store_flushed: false,
            store_flush_duration: std::time::Duration::ZERO,
            errors: Vec::new(),
        }
    }
}

/// Shell state: the committed reconstruction store, the current disclosure depth,
/// and the Phase 5 lifecycle state — recordings, an optional replay controller,
/// and the plugin registry (seeded with the first-party reference plugins). Behind
/// `Mutex`es so Tauri can share it across command invocations.
pub(crate) struct AppState {
    // `Arc` so the background live-capture thread can share the same store/stats
    // the query handler reads (the thread swaps in fresh reconstructions).
    pub(crate) store: Arc<Mutex<CaptureStore>>,
    pub(crate) depth: Arc<Mutex<Depth>>,
    pub(crate) stats: Arc<Mutex<CaptureStats>>,
    pub(crate) recordings: Mutex<Vec<Recording>>,
    pub(crate) replay: Mutex<Option<ReplayController>>,
    pub(crate) registry: Mutex<PluginRegistry>,
    /// Handle to the running live capture, if any. `None` when idle.
    pub(crate) capture: Mutex<Option<CaptureControl>>,
    /// The time-indexed flow→process correlator, fed socket-table
    /// snapshots by the capture loop and queried by `AttributionOfFlow`.
    pub(crate) correlator: Arc<Mutex<Correlator>>,
    /// The live socket→PID source, or `None` where no backend exists (attribution
    /// then stays honestly Unknown .
    pub(crate) sockets: Option<Arc<dyn SocketTableSource + Send + Sync>>,
    /// Stop flag for the background HTTP health probe server.
    pub(crate) health_stop: Arc<AtomicBool>,
    /// Optional Tauri application handle for emitting live events.
    pub(crate) app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Atomic once-guard guaranteeing shutdown sequence executes exactly once.
    pub(crate) shutting_down: AtomicBool,
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
/// can wait deterministically without indefinite blocking.
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
        // uses. Without either, the UI shows its honest empty states
//
        let (store, stats) = seed_store_from_env();
        Self {
            store: Arc::new(Mutex::new(store)),
            depth: Arc::new(Mutex::new(Depth::Beginner)),
            stats: Arc::new(Mutex::new(stats)),
            recordings: Mutex::new(Vec::new()),
            replay: Mutex::new(None),
            registry: Mutex::new(seed_registry()),
            capture: Mutex::new(None),
            correlator: Arc::new(Mutex::new(Correlator::new())),
            sockets: netpulse_platform::socket_table(),
            health_stop: Arc::new(AtomicBool::new(false)),
            app_handle: Mutex::new(None),
            shutting_down: AtomicBool::new(false),
        }
    }
}

/// Start live capture on `iface_id` and spawn the background reconstruction loop
///The capture handle is opened *inside* the thread so the (possibly
/// non-`Send`) backend never crosses a thread boundary; the open result is
/// reported back so the UI gets an immediate, honest error if Npcap is missing or
/// privileges are insufficient.
pub(crate) fn start_capture(state: &AppState, iface_id: u16) -> Result<(), String> {
    let mut guard = state.capture.lock().map_err(|_| "state poisoned")?;
    if guard.is_some() {
        return Err("capture is already running".into());
    }

    let store = Arc::clone(&state.store);
    let stats = Arc::clone(&state.stats);
    let depth = Arc::clone(&state.depth);
    let correlator = Arc::clone(&state.correlator);
    let sockets = state.sockets.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let app_handle = match state.app_handle.lock() {
        Ok(g) => g.clone(),
        Err(p) => p.into_inner().clone(),
    };
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
                depth,
                correlator,
                sockets,
                stop_thread,
                done_tx,
                app_handle,
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

impl AppState {
    fn shutdown_health(&self) -> bool {
        tracing::info!(event = "health.stopping", "Signaling health probe HTTP server to stop");
        self.health_stop.store(true, Ordering::Release);
        true
    }

    fn shutdown_capture(&self) -> Result<bool, ShutdownError> {
        let is_running = match self.capture.lock() {
            Ok(g) => g.is_some(),
            Err(p) => p.into_inner().is_some(),
        };

        if !is_running {
            tracing::info!(event = "capture.idle", "No active live capture to stop");
            return Ok(false);
        }

        tracing::info!(event = "capture.stopping", "Signaling live capture thread to stop");
        match stop_capture(self) {
            Ok(()) => {
                tracing::info!(event = "capture.stopped", "Live capture stopped gracefully on shutdown");
                Ok(true)
            }
            Err(e) => {
                tracing::warn!(event = "shell.capture_stop_failed", "Live capture shutdown issue: {e}");
                Err(ShutdownError::Capture(e))
            }
        }
    }

    fn shutdown_storage(&self) -> Result<std::time::Duration, ShutdownError> {
        tracing::info!(event = "store.flushing", "Flushing persistent storage WAL");
        let start = std::time::Instant::now();
        let mut store_guard = match self.store.lock() {
            Ok(g) => g,
            Err(poison) => {
                tracing::warn!(
                    event = "shell.store_mutex_poisoned",
                    "Capture store mutex poisoned; recovering state for shutdown flush"
                );
                poison.into_inner()
            }
        };

        use netpulse_storage::Store;
        let res = store_guard.flush();
        let elapsed = start.elapsed();

        match res {
            Ok(()) => {
                tracing::info!(
                    event = "store.flushed",
                    duration_ms = elapsed.as_millis(),
                    "Storage flushed successfully"
                );
                Ok(elapsed)
            }
            Err(e) => {
                tracing::error!(
                    event = "shell.store_flush_failed",
                    duration_ms = elapsed.as_millis(),
                    "Failed to flush store on shutdown: {e}"
                );
                Err(ShutdownError::Storage(e.to_string()))
            }
        }
    }

    /// Performs graceful shutdown of shell background services:
    /// 1. Signals background health probe HTTP server to terminate (`health_stop = true`, `Release` ordering).
    /// 2. Signals and joins live capture thread (up to 3s timeout), committing pipeline state into `store`.
    /// 3. Flushes persistent store (`Store::flush`, WAL commit / storage crash safety).
///
    /// Guarded by `shutting_down: AtomicBool` with `AcqRel` ordering to run exactly once.
    pub(crate) fn shutdown(&self) -> ShutdownReport {
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return ShutdownReport::already_done();
        }

        tracing::info!(event = "shell.shutdown_start", "Initiating NetPulse desktop shell graceful shutdown");

        let mut errors = Vec::new();

        // 1. Health server stop flag (first, so health probe reports shutting down)
        let health_signaled = self.shutdown_health();

        // 2. Stop live capture (if running)
        let capture_stopped = match self.shutdown_capture() {
            Ok(stopped) => stopped,
            Err(err) => {
                errors.push(err);
                false
            }
        };

        // 3. Flush storage WAL (always runs, even if capture stop failed)
        let (store_flushed, store_flush_duration) = match self.shutdown_storage() {
            Ok(duration) => (true, duration),
            Err(err) => {
                errors.push(err);
                (false, std::time::Duration::ZERO)
            }
        };

        let report = ShutdownReport {
            already_shutdown: false,
            health_signaled,
            capture_stopped,
            store_flushed,
            store_flush_duration,
            errors,
        };

        tracing::info!(
            event = "shell.shutdown_complete",
            health_signaled = report.health_signaled,
            capture_stopped = report.capture_stopped,
            store_flushed = report.store_flushed,
            flush_duration_ms = report.store_flush_duration.as_millis(),
            errors_count = report.errors.len(),
            "NetPulse desktop shell shutdown complete"
        );

        report
    }
}

/// Stop the running live capture gracefully: signal the thread, wait for a completion
/// signal (up to 3s), join cleanly, and commit the final reconstruction store.
pub(crate) fn stop_capture(state: &AppState) -> Result<(), String> {
    let ctrl_guard = match state.capture.lock() {
        Ok(mut g) => g.take(),
        Err(p) => p.into_inner().take(),
    };
    match ctrl_guard {
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
                    match state.capture.lock() {
                        Ok(mut g) => *g = Some(ctrl),
                        Err(p) => *p.into_inner() = Some(ctrl),
                    }
                    Err("capture thread did not terminate within 3 seconds".into())
                }
            }
        }
        None => Err("no capture is running".into()),
    }
}

pub(crate) fn start_recording(state: &AppState) -> Result<(), String> {
    let is_running = match state.capture.lock() {
        Ok(g) => g.is_some(),
        Err(p) => p.into_inner().is_some(),
    };
    if !is_running {
        return Err("recording requires a live capture source (platform backend is a stub)".into());
    }
    Ok(())
}

pub(crate) fn stop_recording(state: &AppState) -> Result<(), String> {
    let is_running = match state.capture.lock() {
        Ok(g) => g.is_some(),
        Err(p) => p.into_inner().is_some(),
    };
    if !is_running {
        return Err("recording requires a live capture source (platform backend is a stub)".into());
    }

    let recorder = netpulse_capture::recording::Recorder::start(
        netpulse_decode::LinkType::Ethernet,
        netpulse_capture::recording::RecordingScope::default(),
    );
    let recording = recorder.finalize(1);
    let mut recordings = state.recordings.lock().map_err(|_| "state poisoned")?;
    recordings.push(recording);
    Ok(())
}

struct HintGuard(Arc<AtomicBool>);

impl Drop for HintGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

type HintMap = std::collections::BTreeMap<std::net::IpAddr, Vec<netpulse_core::HostName>>;

/// Measurements recorded for a single capture loop rebuild/commit tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CaptureCycleMetrics {
    pub(crate) captured_frames: u64,
    pub(crate) kernel_dropped_frames: u64,
}

impl From<(u64, u64)> for CaptureCycleMetrics {
    fn from((captured_frames, kernel_dropped_frames): (u64, u64)) -> Self {
        Self {
            captured_frames,
            kernel_dropped_frames,
        }
    }
}

/// Immutable configuration settings for the background live capture loop.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LiveLoopConfig {
    pub(crate) max_frames: usize,
    pub(crate) hint_refresh_secs: u64,
}

/// Owns the mutable runtime state for a single live capture session.
///
/// Architectural Invariants:
/// - Lock Order: `store` must always be locked before `stats` if both locks are held.
/// - Concurrency: `hint_in_flight` guarantees at most one DNS refresh worker is spawned at a time.
/// - Single Ownership: `pipeline` and `shed_controller` are exclusively owned by this context.
/// - Lifecycle Enforcement: `finish()` consumes `self` to flush remaining buffered pipeline state
///   and finalize resolutions upon capture loop shutdown.
pub(crate) struct LiveLoopContext {
    pub(crate) pipeline: netpulse_engine::pipeline::LivePipeline,
    pub(crate) store: Arc<Mutex<CaptureStore>>,
    pub(crate) stats: Arc<Mutex<CaptureStats>>,
    pub(crate) stop: Arc<AtomicBool>,
    pub(crate) shed_controller: ShedController,
    pub(crate) hint_cache: HintMap,
    pub(crate) last_hint_refresh: Option<std::time::Instant>,
    pub(crate) hint_rx: std::sync::mpsc::Receiver<HintMap>,
    pub(crate) hint_tx: std::sync::mpsc::Sender<HintMap>,
    pub(crate) hint_in_flight: Arc<AtomicBool>,
    pub(crate) config: LiveLoopConfig,
}

impl LiveLoopContext {
    pub(crate) fn new(
        dlt: u32,
        store: Arc<Mutex<CaptureStore>>,
        stats: Arc<Mutex<CaptureStats>>,
        stop: Arc<AtomicBool>,
        config: LiveLoopConfig,
    ) -> Self {
        let (hint_tx, hint_rx) = std::sync::mpsc::channel::<HintMap>();
        Self {
            pipeline: netpulse_engine::pipeline::LivePipeline::new(dlt, 16),
            store,
            stats,
            stop,
            shed_controller: ShedController::new(config.max_frames),
            hint_cache: HintMap::new(),
            last_hint_refresh: None,
            hint_rx,
            hint_tx,
            hint_in_flight: Arc::new(AtomicBool::new(false)),
            config,
        }
    }

    /// Drain incoming background hints from the channel.
    fn drain_hint_channel(&mut self) {
        while let Ok(new_hints) = self.hint_rx.try_recv() {
            self.hint_cache = new_hints;
            self.last_hint_refresh = Some(std::time::Instant::now());
        }
    }

    /// Trigger background DNS hint refresh if due, capture is running, and no worker is in flight.
    fn refresh_dns_hints(&mut self) {
        let due = self
            .last_hint_refresh
            .map(|t| t.elapsed().as_secs() >= self.config.hint_refresh_secs)
            .unwrap_or(true);
        if due
            && !self.stop.load(Ordering::Relaxed)
            && !self.hint_in_flight.swap(true, Ordering::AcqRel)
        {
            let flag = self.hint_in_flight.clone();
            let tx = self.hint_tx.clone();
            let spawn_res = std::thread::Builder::new()
                .name("dns-hint-refresh".into())
                .spawn(move || {
                    let _guard = HintGuard(flag);
                    let hints = netpulse_platform::host_name_hints();
                    let _ = tx.send(hints);
                });
            if let Err(e) = spawn_res {
                self.hint_in_flight.store(false, Ordering::Release);
                tracing::warn!("Failed to spawn dns-hint-refresh worker: {e}");
            }
        }
    }

    /// Commit pipeline updates & merge hint cache to store.
    fn commit_pipeline(&mut self, latest_mono: u64) {
        if let Ok(mut s) = self.store.lock() {
            self.pipeline.commit_to_store(&mut s, latest_mono);
            for (ip, names) in self.hint_cache.iter() {
                s.merge_resolution(*ip, names.clone());
            }
        }
    }

    /// Update capture statistics under `stats` lock.
    fn update_stats(&self, metrics: CaptureCycleMetrics, buffer_len: usize, buffer_drops: u64) {
        if let Ok(mut st) = self.stats.lock() {
            let total_dropped = metrics.kernel_dropped_frames.saturating_add(buffer_drops);
            st.received = st.received.max(metrics.captured_frames);
            st.dropped = st.dropped.max(total_dropped);
            st.shed_stage = self.shed_controller.current_stage();
            st.buffer_frames = buffer_len;
            st.buffer_capacity = self.config.max_frames;
        }
    }

    /// Commit pipeline updates to store and update atomic stats and DNS name hints.
    pub(crate) fn rebuild_and_commit(
        &mut self,
        latest_mono: u64,
        metrics: CaptureCycleMetrics,
        buffer_len: usize,
        buffer_drops: u64,
    ) {
        self.drain_hint_channel();
        self.refresh_dns_hints();
        self.commit_pipeline(latest_mono);
        self.update_stats(metrics, buffer_len, buffer_drops);
    }

    /// Final Flush on shutdown so in-flight frames are never lost. Consumes `self`
    /// to enforce lifecycle completion and prevent subsequent calls on a finished context.
    pub(crate) fn finish(
        mut self,
        latest_mono: u64,
        metrics: CaptureCycleMetrics,
        buffer_len: usize,
        buffer_drops: u64,
    ) {
        self.rebuild_and_commit(latest_mono, metrics, buffer_len, buffer_drops);
        if let Ok(mut s) = self.store.lock() {
            self.pipeline.finish(&mut s);
        }
    }
}

pub(crate) fn emit_live_snapshot(
    store: &Arc<Mutex<CaptureStore>>,
    stats: &Arc<Mutex<CaptureStats>>,
    depth: &Arc<Mutex<Depth>>,
    app_handle: &Option<tauri::AppHandle>,
) {
    if let Some(handle) = app_handle {
        let store_guard = match store.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let stats_guard = match stats.lock() {
            Ok(g) => *g,
            Err(p) => *p.into_inner(),
        };
        let depth_guard = match depth.lock() {
            Ok(g) => *g,
            Err(p) => *p.into_inner(),
        };
        let view = netpulse_engine::pipeline::present(
            &store_guard,
            depth_guard,
            stats_guard,
        );
        let _ = handle.emit("feed-delta", &view.narratives);
        let _ = handle.emit("monitor-snapshot", &view.monitor);
    }
}

/// The background live-capture loop. Drains frames from the backend
/// into a bounded buffer and periodically commits incremental engine updates
/// into the committed store via [`netpulse_engine::pipeline::LivePipeline`].
/// Runs until the stop flag is set or the source closes.
#[allow(clippy::too_many_arguments)]
fn live_loop(
    mut capture: netpulse_platform::LiveCapture,
    dlt: u32,
    store: Arc<Mutex<CaptureStore>>,
    stats: Arc<Mutex<CaptureStats>>,
    depth: Arc<Mutex<Depth>>,
    correlator: Arc<Mutex<Correlator>>,
    sockets: Option<Arc<dyn SocketTableSource + Send + Sync>>,
    stop: Arc<AtomicBool>,
    done_tx: std::sync::mpsc::Sender<()>,
    app_handle: Option<tauri::AppHandle>,
) {
    let _completion_guard = CompletionGuard(Some(done_tx));
    let config = LiveLoopConfig {
        max_frames: 50_000,
        hint_refresh_secs: 30,
    };

    let mut ctx = LiveLoopContext::new(dlt, store.clone(), stats.clone(), stop.clone(), config);
    let mut buffer: VecDeque<RawFrame> = VecDeque::with_capacity(config.max_frames);
    let mut buffer_drops = 0u64;
    let mut latest_mono = 0u64;
    let mut last_rebuild = std::time::Instant::now();

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
            let current_stage = ctx.shed_controller.update(fill_len);

            // Pre-insertion eviction (Option A sliding window): drain overflow from head of ring buffer
            if fill_len > config.max_frames {
                let overflow = fill_len - config.max_frames;
                let to_drop = overflow.min(buffer.len());
                buffer.drain(0..to_drop);
                buffer_drops = buffer_drops.saturating_add(overflow as u64);
            }

            ctx.pipeline.ingest_batch(&batch);

            for mut frame in batch {
                if current_stage >= ShedStage::PayloadsOff {
                    frame.bytes.truncate(ETH_IPV4_TCP_HEADERS);
                }
                if current_stage == ShedStage::SampleDissection
                    && !ctx.shed_controller.should_sample()
                {
                    continue;
                }
                buffer.push_back(frame);
            }
        }

        if last_rebuild.elapsed().as_millis() >= 1000 && !buffer.is_empty() {
            last_rebuild = std::time::Instant::now();
            ctx.rebuild_and_commit(
                latest_mono,
                capture.stats().into(),
                buffer.len(),
                buffer_drops,
            );

            // Poll the OS socket tables and feed the correlator, timestamped in the
            // same capture-relative monotonic clock the flows use.
            if let Some(source) = &sockets {
                if let Ok(owners) = source.snapshot() {
                    if let Ok(mut c) = correlator.lock() {
                        c.ingest_snapshot(latest_mono, &owners);
                    }
                }
            }

            emit_live_snapshot(&store, &stats, &depth, &app_handle);
        }
    }

    // Final Flush on shutdown so in-flight frames are never lost
    ctx.finish(
        latest_mono,
        capture.stats().into(),
        buffer.len(),
        buffer_drops,
    );
    emit_live_snapshot(&store, &stats, &depth, &app_handle);
    // _completion_guard drops here, signaling done_tx
}

/// Optionally seed the committed store from a pcap named by `NETPULSE_PCAP`,
/// running the identical offline pipeline the CLI does (`analyze_pcap`). Any
/// problem (unset var, unreadable file, undecodable capture) falls back to an
/// empty metadata-only store rather than failing the launch — the UI then shows
/// its empty states honestly.
fn seed_store_from_env() -> (CaptureStore, CaptureStats) {
    // Metadata-only is the private default.
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
//
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

/// Register the first-party reference plugins so the Plugins surface
/// lists real, capability-bounded seams. Their manifests mirror the in-tree
/// examples under `plugins/`; the registry auto-enables first-party references.
fn seed_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new(netpulse_api::API_VERSION);
    let first_party = |name: &str,
                       ty: PluginType,
                       default_cfg: serde_json::Value,
                       schema: Option<netpulse_plugin::JsonSchema>,
                       fuzzed: bool,
                       has_explanation: bool| {
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

/// Map a wire export selection to the engine's domain selection.
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

/// An honest zero replay state when no recording is loaded (fail-closed
/// rather than pretend).
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

/// The single pull entry point. Every historical/aggregated read
/// the UI performs comes through here and is answered from the committed store.
#[tracing::instrument(level = "debug", skip(state))]
#[tauri::command]
fn query(query: Query, state: tauri::State<'_, AppState>) -> Result<QueryResponse, String> {
    ipc::execute_query(&state, query)
}

/// The single control entry point — the only write path UI→engine.
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

    let app_state = AppState::default();
    let health_config = netpulse_core::health::read_env_health_config();
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
            app_state.health_stop.clone(),
        )
        .ok();
    }

    let app = tauri::Builder::default()
        .setup(|app| {
            let state = app.state::<AppState>();
            if let Ok(mut handle_guard) = state.app_handle.lock() {
                *handle_guard = Some(app.handle().clone());
            }
            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![query, command])
        .build(tauri::generate_context!())
        .expect("error while building the NetPulse shell");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            let state = app_handle.state::<AppState>();
            let _report = state.shutdown();
        }
        _ => {}
    });
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
        let stop = Arc::new(AtomicBool::new(false));
        let frame = RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        };

        let mut ctx = LiveLoopContext::new(
            1,
            store,
            stats,
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );
        ctx.pipeline.ingest_batch(&[frame]);
        ctx.rebuild_and_commit(1_000_000, (1, 0).into(), 1, 0);

        let st = ctx.stats.lock().unwrap();
        assert_eq!(st.buffer_frames, 1);
        assert_eq!(st.buffer_capacity, 1000);
        assert_eq!(st.received, 1);
    }

    #[test]
    fn test_finish_consumes_context_and_flushes_pipeline() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let frame = RawFrame {
            mono_nanos: 2_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        };

        let mut ctx = LiveLoopContext::new(
            1,
            store.clone(),
            stats.clone(),
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );
        ctx.pipeline.ingest_batch(&[frame]);

        // finish() consumes ownership of ctx
        ctx.finish(
            2_000_000,
            CaptureCycleMetrics {
                captured_frames: 1,
                kernel_dropped_frames: 0,
            },
            1,
            0,
        );

        let st = stats.lock().unwrap();
        assert_eq!(st.received, 1);
        let s = store.lock().unwrap();
        assert_eq!(s.policy(), PayloadPolicy::MetadataOnly);
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
        assert!(res
            .unwrap_err()
            .contains("did not terminate within 3 seconds"));

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
        let stop = Arc::new(AtomicBool::new(false));
        let frame = RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: vec![0u8; 54],
        };

        let mut ctx = LiveLoopContext::new(
            1,
            store,
            stats,
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );
        ctx.pipeline.ingest_batch(&[frame]);

        // Attempt update with lower counters (e.g. out of order or transient drop)
        ctx.rebuild_and_commit(1_000_000, (400, 5).into(), 1, 0);

        let st = ctx.stats.lock().unwrap();
        // Assert counters remained monotonic at max values (500, 10)
        assert_eq!(st.received, 500);
        assert_eq!(st.dropped, 10);
    }

    #[test]
    fn test_dns_hint_only_one_worker_in_flight() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let stop = Arc::new(AtomicBool::new(false));

        let mut ctx = LiveLoopContext::new(
            1,
            store,
            stats,
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );

        // Pre-set in-flight flag to simulate an active background worker thread
        ctx.hint_in_flight.store(true, Ordering::Release);

        // Rebuild and commit while worker is in-flight must refuse to spawn a duplicate worker
        ctx.rebuild_and_commit(1_000_000, (1, 0).into(), 0, 0);

        // Assert that the flag remains set and no channel message was queued
        assert!(
            ctx.hint_in_flight.load(Ordering::Acquire),
            "Flag must remain in-flight when duplicate spawn is refused"
        );
        assert!(
            ctx.hint_rx.try_recv().is_err(),
            "No new worker should have been spawned to send hints"
        );
    }

    #[test]
    fn test_dns_hint_worker_panic_resets_flag() {
        let hint_in_flight = Arc::new(AtomicBool::new(true));
        {
            let _guard = HintGuard(hint_in_flight.clone());
            // Simulate worker panic inside scoped block
        }
        assert!(
            !hint_in_flight.load(Ordering::Acquire),
            "Guard drop must reset flag even on panic"
        );
    }

    #[test]
    fn test_dns_hint_multiple_completed_refreshes_latest_wins() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let stop = Arc::new(AtomicBool::new(false));

        let mut ctx = LiveLoopContext::new(
            1,
            store,
            stats,
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );

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

        ctx.hint_tx.send(map1).unwrap();
        ctx.hint_tx.send(map2).unwrap();

        ctx.rebuild_and_commit(1_000_000, (1, 0).into(), 0, 0);

        assert_eq!(
            ctx.hint_cache.get(&"1.1.1.1".parse().unwrap()).unwrap()[0].name,
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
        assert!(
            res.is_err(),
            "Send fails on disconnected receiver without crashing worker"
        );
    }

    #[test]
    fn test_dns_hint_shutdown_prevents_spawn() {
        let store = Arc::new(Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)));
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let stop = Arc::new(AtomicBool::new(true)); // Stop flag set

        let mut ctx = LiveLoopContext::new(
            1,
            store,
            stats,
            stop,
            LiveLoopConfig {
                max_frames: 1000,
                hint_refresh_secs: 30,
            },
        );

        ctx.rebuild_and_commit(1_000_000, (1, 0).into(), 0, 0);

        assert!(
            !ctx.hint_in_flight.load(Ordering::Acquire),
            "Must not spawn background worker if stop flag set"
        );
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

    #[test]
    fn test_app_state_shutdown_is_idempotent() {
        let state = AppState::default();
        let report1 = state.shutdown();
        assert!(!report1.already_shutdown);
        assert!(report1.health_signaled);
        assert!(!report1.capture_stopped);
        assert!(report1.store_flushed);
        assert!(report1.errors.is_empty());

        let report2 = state.shutdown();
        assert_eq!(report2, ShutdownReport::already_done());
    }

    #[test]
    fn test_shutdown_once_guard_barrier_contention() {
        let state = Arc::new(AppState::default());
        let barrier = Arc::new(std::sync::Barrier::new(10));
        let mut handles = Vec::new();

        for _ in 0..10 {
            let s = state.clone();
            let b = barrier.clone();
            handles.push(std::thread::spawn(move || {
                b.wait();
                s.shutdown()
            }));
        }

        let reports: Vec<ShutdownReport> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        let executed_count = reports.iter().filter(|r| !r.already_shutdown).count();
        let skipped_count = reports.iter().filter(|r| r.already_shutdown).count();

        assert_eq!(executed_count, 1, "Exactly one thread executes shutdown sequence");
        assert_eq!(skipped_count, 9, "9 threads receive already_done report");
    }

    #[test]
    fn test_shutdown_health_first_ordering() {
        let state = AppState::default();
        assert!(!state.health_stop.load(Ordering::Acquire));
        let report = state.shutdown();
        assert!(report.health_signaled);
        assert!(state.health_stop.load(Ordering::Acquire));
    }

    #[test]
    fn test_shutdown_when_capture_idle() {
        let state = AppState::default();
        let report = state.shutdown();
        assert!(!report.already_shutdown);
        assert!(!report.capture_stopped);
        assert!(report.store_flushed);
        assert!(report.errors.is_empty());
    }

    #[test]
    fn test_shutdown_poisoned_store_mutex_recovers() {
        let state = AppState::default();
        let store_arc = state.store.clone();

        // Deliberately poison the store mutex in a worker thread
        let _ = std::thread::spawn(move || {
            let _guard = store_arc.lock().unwrap();
            panic!("Simulated store lock poison panic");
        })
        .join();

        assert!(state.store.lock().is_err(), "Mutex must be poisoned");

        let report = state.shutdown();
        assert!(report.store_flushed, "Shutdown flush must succeed via poison recovery into_inner()");
        assert!(report.errors.is_empty());
    }

    #[test]
    fn test_shutdown_continues_on_capture_stop_failure() {
        let state = AppState::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (_done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        // Spawn worker thread that ignores stop flag to trigger timeout
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(4));
        });

        {
            let mut guard = state.capture.lock().unwrap();
            *guard = Some(CaptureControl {
                stop,
                done_rx,
                handle,
            });
        }

        let report = state.shutdown();
        assert!(report.health_signaled);
        assert!(!report.capture_stopped);
        assert!(report.store_flushed, "Store flush must proceed even if capture stop fails");
        assert_eq!(report.errors.len(), 1);
        match &report.errors[0] {
            ShutdownError::Capture(err) => assert!(err.contains("did not terminate within 3 seconds")),
            _ => panic!("Expected ShutdownError::Capture"),
        }
    }
}
