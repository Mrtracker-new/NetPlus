//! Durable write-behind mirror: the SQLite record behind the in-memory
//! [`CaptureStore`](crate::CaptureStore).
//!
//! ## Why this exists
//!
//! `CaptureStore` is the fast in-memory reconstruction the engine reads on every
//! query, and it is bounded (eviction) so it never grows without limit. Durability
//! is a *different* concern: the flows/sessions/resolutions/findings that were
//! observed should survive a restart even after the in-memory window has rotated.
//!
//! The mirror deliberately does **not** share the store's mutex and does not issue
//! blocking SQL from the capture thread or from a query handler:
//!
//! * [`DurableLog::enqueue`] is a non-blocking send onto a bounded channel.
//! * A dedicated writer thread owns a small Tokio runtime, the
//!   [`SqliteCaptureRepository`], and performs the async upserts in FIFO order.
//!
//! ## Honesty rules (no silent data loss)
//!
//! * Every failed write is logged at `error` level and counted in
//!   [`DurableHealth`]; the last error is retained and surfaced by
//!   `Query::HealthCheck` and by the shell's shutdown report.
//! * [`DurableLog::flush`] is a barrier: it waits for all previously enqueued
//!   records to be attempted and returns `Err` if any of them failed or if the
//!   barrier did not complete before the timeout. `Store::flush` propagates that
//!   result, so a shutdown can no longer log success for a store that never
//!   persisted anything.
//! * [`DurableLog::open`] fails (rather than degrading silently) when the writer
//!   cannot connect or report readiness, so the caller can decide how to react.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex as StdMutex};
use std::thread::JoinHandle;
use std::time::Duration;

use netpulse_core::{Finding, Flow, Host, HostName, ProtoEvent, Session};

use crate::capture_store::{read_repository_snapshot, CaptureStoreSnapshot};
use crate::error::StorageError;

/// Maximum number of records buffered before `enqueue` reports back-pressure.
/// Bounded so a stalled writer surfaces as an explicit error instead of
/// unbounded memory growth in the capture loop.
pub const DURABLE_QUEUE_CAPACITY: usize = 65_536;

/// How long the writer waits for the next record before re-checking its stop flag.
const WRITER_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// How long [`DurableLog::open`] waits for the writer to connect and hydrate.
const READY_TIMEOUT: Duration = Duration::from_secs(15);

/// One durable write, mirroring a single [`CaptureStore`](crate::CaptureStore) mutation.
#[derive(Debug)]
pub enum DurableRecord {
    /// A flow upsert plus its protocol events.
    Flow(Flow, Vec<ProtoEvent>),
    /// A session upsert (also links its flows to the session).
    Session(Session),
    /// A host upsert.
    Host(u64, Host),
    /// Replace all names observed for an IP.
    Resolution(IpAddr, Vec<HostName>),
    /// Additively merge names observed for an IP.
    MergeResolution(IpAddr, Vec<HostName>),
    /// A security finding upsert.
    Finding(Finding),
}

/// Observable state of the durable mirror. Never fabricated: `connected` and the
/// counters reflect what the writer thread actually did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableHealth {
    /// The writer connected to the database successfully.
    pub connected: bool,
    /// The writer has stopped (cleanly or after a failure).
    pub closed: bool,
    /// Records accepted onto the queue.
    pub queued: u64,
    /// Records successfully applied to the database.
    pub applied: u64,
    /// Records that failed to apply (each logged with its error).
    pub failed: u64,
    /// The most recent failure, retained for diagnostics.
    pub last_error: Option<String>,
    /// Database file backing the mirror.
    pub path: String,
}

impl DurableHealth {
    /// True when the mirror connected and never failed a write. `closed` is
    /// informational (true after a clean shutdown), not a health problem.
    pub fn is_healthy(&self) -> bool {
        self.connected && self.failed == 0 && self.last_error.is_none()
    }

    /// True when at least one write was dropped, or the mirror never connected
    /// (in which case nothing was persisted at all).
    pub fn has_loss(&self) -> bool {
        self.failed > 0 || !self.connected
    }
}

#[derive(Debug)]
enum Command {
    Record(DurableRecord),
    /// Barrier: reply once every previously enqueued record has been attempted.
    Barrier(SyncSender<Result<(), String>>),
    Stop,
}

#[derive(Debug)]
struct Shared {
    connected: AtomicBool,
    closed: AtomicBool,
    requested_stop: AtomicBool,
    queued: AtomicU64,
    applied: AtomicU64,
    failed: AtomicU64,
    last_error: StdMutex<Option<String>>,
}

impl Shared {
    fn new() -> Self {
        Self {
            connected: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            requested_stop: AtomicBool::new(false),
            queued: AtomicU64::new(0),
            applied: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            last_error: StdMutex::new(None),
        }
    }

    fn record_failure(&self, message: String) {
        self.failed.fetch_add(1, Ordering::AcqRel);
        tracing::error!(
            event = "storage.durable_write_failed",
            error = %message,
            "Durable write failed; the record is retained in the database's last good state"
        );
        match self.last_error.lock() {
            Ok(mut guard) => *guard = Some(message),
            Err(poison) => *poison.into_inner() = Some(message),
        }
    }

    fn clear_error(&self) {
        match self.last_error.lock() {
            Ok(mut guard) => *guard = None,
            Err(poison) => *poison.into_inner() = None,
        }
    }

    fn error_snapshot(&self) -> Option<String> {
        match self.last_error.lock() {
            Ok(guard) => guard.clone(),
            Err(poison) => poison.into_inner().clone(),
        }
    }
}

/// The durable mirror handle. Cloneable by sharing the underlying `Arc`; the
/// writer thread is joined by [`DurableLog::shutdown`].
#[derive(Debug)]
pub struct DurableLog {
    tx: SyncSender<Command>,
    shared: Arc<Shared>,
    path: PathBuf,
    handle: StdMutex<Option<JoinHandle<()>>>,
}

impl DurableLog {
    /// Open (or create) the SQLite database at `path`, spawn the writer thread,
    /// and return the log plus the snapshot of everything already persisted, so
    /// the caller can hydrate its in-memory store for restart continuity.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<(Self, CaptureStoreSnapshot), StorageError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let (tx, rx) = sync_channel::<Command>(DURABLE_QUEUE_CAPACITY);
        let (ready_tx, ready_rx) = sync_channel::<Result<CaptureStoreSnapshot, String>>(1);
        let shared = Arc::new(Shared::new());

        let thread_shared = Arc::clone(&shared);
        let thread_path = path.clone();
        let handle = std::thread::Builder::new()
            .name("netpulse-durable".into())
            .spawn(move || writer_thread(thread_path, rx, thread_shared, ready_tx))
            .map_err(|e| StorageError::DurableWriterUnavailable {
                reason: format!("failed to spawn durable writer thread: {e}"),
            })?;

        match ready_rx.recv_timeout(READY_TIMEOUT) {
            Ok(Ok(snapshot)) => Ok((
                Self {
                    tx,
                    shared,
                    path,
                    handle: StdMutex::new(Some(handle)),
                },
                snapshot,
            )),
            Ok(Err(reason)) => {
                let _ = handle.join();
                Err(StorageError::DurableWriterUnavailable { reason })
            }
            Err(_) => {
                shared.requested_stop.store(true, Ordering::Release);
                Err(StorageError::DurableWriterUnavailable {
                    reason: format!(
                        "durable writer did not report readiness within {}s",
                        READY_TIMEOUT.as_secs()
                    ),
                })
            }
        }
    }

    /// The database file backing this mirror.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Queue one record for durable persistence.
    ///
    /// Returns `Err` when the queue is full (writer stalled) or the writer has
    /// exited; in both cases the caller must treat the write as *not* durable.
    pub fn enqueue(&self, record: DurableRecord) -> Result<(), String> {
        match self.tx.try_send(Command::Record(record)) {
            Ok(()) => {
                self.shared.queued.fetch_add(1, Ordering::AcqRel);
                Ok(())
            }
            Err(TrySendError::Full(_)) => {
                let msg = format!(
                    "durable write queue full ({DURABLE_QUEUE_CAPACITY} records); writer is not keeping up"
                );
                self.shared.record_failure(msg.clone());
                Err(msg)
            }
            Err(TrySendError::Disconnected(_)) => {
                let msg = "durable writer thread is not running".to_string();
                self.shared.record_failure(msg.clone());
                Err(msg)
            }
        }
    }

    /// Current health of the mirror.
    pub fn health(&self) -> DurableHealth {
        DurableHealth {
            connected: self.shared.connected.load(Ordering::Acquire),
            closed: self.shared.closed.load(Ordering::Acquire),
            queued: self.shared.queued.load(Ordering::Acquire),
            applied: self.shared.applied.load(Ordering::Acquire),
            failed: self.shared.failed.load(Ordering::Acquire),
            last_error: self.shared.error_snapshot(),
            path: self.path.display().to_string(),
        }
    }

    /// Wait until every record enqueued before this call has been attempted,
    /// then checkpoint the WAL. Fails on timeout or if any write has failed, so
    /// success here means "everything so far is durable", not merely "we didn't
    /// hear otherwise".
    pub fn flush(&self, timeout: Duration) -> Result<(), String> {
        let (reply_tx, reply_rx) = sync_channel::<Result<(), String>>(1);
        self.tx
            .send(Command::Barrier(reply_tx))
            .map_err(|_| "durable writer thread is not running".to_string())?;

        match reply_rx.recv_timeout(timeout) {
            Ok(Ok(())) => {
                self.shared.clear_error();
                Ok(())
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err(format!(
                "durable flush did not complete within {}s",
                timeout.as_secs()
            )),
        }
    }

    /// Stop the writer after draining pending records, join it, and report the
    /// final health. Idempotent.
    pub fn shutdown(&self) -> DurableHealth {
        self.shared.requested_stop.store(true, Ordering::Release);
        let _ = self.tx.send(Command::Stop);
        let handle = match self.handle.lock() {
            Ok(mut guard) => guard.take(),
            Err(poison) => poison.into_inner().take(),
        };
        if let Some(handle) = handle {
            if handle.join().is_err() {
                self.shared
                    .record_failure("durable writer thread panicked".to_string());
            }
        }
        self.health()
    }
}

impl Drop for DurableLog {
    fn drop(&mut self) {
        // Best-effort stop signal; the writer drains what it can and exits. The
        // shell calls `shutdown()` explicitly so the final flush is deterministic.
        self.shared.requested_stop.store(true, Ordering::Release);
        let _ = self.tx.try_send(Command::Stop);
    }
}

fn writer_thread(
    path: PathBuf,
    rx: Receiver<Command>,
    shared: Arc<Shared>,
    ready: SyncSender<Result<CaptureStoreSnapshot, String>>,
) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            let _ = ready.send(Err(format!("failed to build writer runtime: {e}")));
            shared.closed.store(true, Ordering::Release);
            return;
        }
    };

    let path_display = path.display().to_string();
    runtime.block_on(async move {
        let repository = match crate::repository::SqliteCaptureRepository::connect(&path).await {
            Ok(repo) => repo,
            Err(e) => {
                let _ = ready.send(Err(format!("cannot open {}: {e}", path_display)));
                shared.closed.store(true, Ordering::Release);
                return;
            }
        };

        match read_repository_snapshot(&repository).await {
            Ok(snapshot) => {
                shared.connected.store(true, Ordering::Release);
                let _ = ready.send(Ok(snapshot));
            }
            Err(e) => {
                let _ = ready.send(Err(format!("cannot read {}: {e}", path_display)));
                shared.closed.store(true, Ordering::Release);
                return;
            }
        }

        // One-time full integrity check, here rather than in
        // `SqliteCaptureRepository::connect`: `PRAGMA integrity_check` walks every
        // page of the database, and running it on every pool open turned an O(1)
        // connect into an O(database) scan. Once per session, off the query path, is
        // where it belongs; `NETPULSE_SKIP_INTEGRITY_CHECK` opts out for very large
        // stores. A failure is recorded so health and shutdown report it instead of
        // silently writing into a corrupt file.
        if std::env::var_os("NETPULSE_SKIP_INTEGRITY_CHECK").is_none() {
            match crate::migration::MigrationManager::verify_integrity(repository.pool()).await {
                Ok(()) => tracing::info!(
                    event = "storage.integrity_ok",
                    path = %path_display,
                    "Durable database integrity verified"
                ),
                Err(e) => {
                    tracing::error!(
                        event = "storage.integrity_failed",
                        path = %path_display,
                        error = %e,
                        "Durable database failed PRAGMA integrity_check; the failure is reported through health"
                    );
                    shared.record_failure(format!("database integrity check failed: {e}"));
                }
            }
        }

        tracing::info!(
            event = "storage.durable_started",
            path = %path_display,
            "Durable write-behind mirror connected"
        );

        let mut stopping = false;
        loop {
            match rx.recv_timeout(WRITER_POLL_INTERVAL) {
                Ok(Command::Record(record)) => apply_record(&repository, record, &shared).await,
                Ok(Command::Barrier(reply)) => {
                    let _ = reply.send(checkpoint(&repository, &shared).await);
                }
                Ok(Command::Stop) | Err(RecvTimeoutError::Disconnected) => {
                    stopping = true;
                }
                Err(RecvTimeoutError::Timeout) => {
                    if shared.requested_stop.load(Ordering::Acquire) {
                        stopping = true;
                    }
                }
            }
            if stopping {
                break;
            }
        }

        // Drain everything already queued so a clean stop never drops a record.
        loop {
            match rx.try_recv() {
                Ok(Command::Record(record)) => apply_record(&repository, record, &shared).await,
                Ok(Command::Barrier(reply)) => {
                    let _ = reply.send(checkpoint(&repository, &shared).await);
                }
                Ok(Command::Stop) | Err(_) => break,
            }
        }

        if let Err(e) = checkpoint(&repository, &shared).await {
            shared.record_failure(format!("final WAL checkpoint failed: {e}"));
        }
        shared.closed.store(true, Ordering::Release);
        tracing::info!(
            event = "storage.durable_stopped",
            path = %path_display,
            applied = shared.applied.load(Ordering::Acquire),
            failed = shared.failed.load(Ordering::Acquire),
            "Durable write-behind mirror stopped"
        );
    });
}

async fn apply_record(
    repository: &crate::repository::SqliteCaptureRepository,
    record: DurableRecord,
    shared: &Shared,
) {
    use crate::repository::CaptureRepository;

    let result = match record {
        DurableRecord::Flow(flow, events) => repository.insert_flow(flow, events).await,
        DurableRecord::Session(session) => repository.insert_session(session).await,
        DurableRecord::Host(id, host) => repository.insert_host(id, host).await,
        DurableRecord::Resolution(ip, names) => repository.set_resolution(ip, names).await,
        DurableRecord::MergeResolution(ip, names) => repository.merge_resolution(ip, names).await,
        DurableRecord::Finding(finding) => repository.insert_finding(finding).await,
    };

    match result {
        Ok(()) => {
            shared.applied.fetch_add(1, Ordering::AcqRel);
        }
        Err(e) => shared.record_failure(e.to_string()),
    }
}

async fn checkpoint(
    repository: &crate::repository::SqliteCaptureRepository,
    shared: &Shared,
) -> Result<(), String> {
    if shared.failed.load(Ordering::Acquire) > 0 {
        return Err(shared
            .error_snapshot()
            .unwrap_or_else(|| "one or more durable writes failed".to_string()));
    }
    sqlx::query("PRAGMA wal_checkpoint(PASSIVE);")
        .execute(repository.pool())
        .await
        .map_err(|e| format!("WAL checkpoint failed: {e}"))?;
    Ok(())
}
