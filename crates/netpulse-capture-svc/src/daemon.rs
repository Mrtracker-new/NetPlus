//! Privileged Packet Capture Daemon Server & State Machine.
//!
//! Manages daemon lifecycle states, OS-native privilege isolation, dedicated high-priority
//! synchronous packet capture thread, and IPC socket frame transport streaming.

use netpulse_capture::{ShedController, ShedStage, ETH_IPV4_TCP_HEADERS};
use netpulse_core::error::NpError;
use netpulse_core::traits::CaptureSource;
use netpulse_core::Result;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Arc;

use crate::transport::{
    BinaryFrame, BinaryFrameBatch, FrameHeader, TransportStats, FLAG_STATS_PRESENT,
};

/// High-level daemon execution lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonState {
    Starting,
    Binding,
    Capturing,
    Streaming,
    ClientDisconnected,
    CaptureError,
    Shutdown,
    Stopped,
}

/// Configuration settings for the privileged capture daemon process.
#[derive(Debug, Clone)]
pub struct DaemonConfig {
    pub iface_id: u16,
    pub socket_path: String,
    pub buffer_capacity: usize,
    pub max_batch_size: usize,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            iface_id: 0,
            socket_path: "netpulse-capture.sock".into(),
            buffer_capacity: 50_000,
            max_batch_size: 256,
        }
    }
}

/// Privileged capture daemon server.
#[derive(Debug)]
pub struct CaptureDaemon {
    config: DaemonConfig,
    state: DaemonState,
    stop_flag: Arc<AtomicBool>,
}

impl CaptureDaemon {
    pub fn new(config: DaemonConfig) -> Self {
        Self {
            config,
            state: DaemonState::Starting,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn state(&self) -> DaemonState {
        self.state
    }

    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.stop_flag)
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        self.state = DaemonState::Shutdown;
    }

    /// Run the privileged capture daemon: spawns the dedicated capture thread
    /// and streams framed binary batches into `writer`.
    pub fn run_stream<W: Write>(&mut self, mut writer: W) -> Result<()> {
        self.state = DaemonState::Binding;
        tracing::info!(
            event = "daemon.binding",
            socket = %self.config.socket_path,
            "Binding capture daemon IPC transport stream"
        );

        self.state = DaemonState::Capturing;
        let (tx, rx): (SyncSender<BinaryFrameBatch>, Receiver<BinaryFrameBatch>) =
            sync_channel(128);

        let stop = Arc::clone(&self.stop_flag);
        let iface_id = self.config.iface_id;
        let capacity = self.config.buffer_capacity;
        let max_batch_size = self.config.max_batch_size;

        let capture_handle = std::thread::spawn(move || {
            capture_worker_loop(iface_id, capacity, max_batch_size, stop, tx);
        });

        self.state = DaemonState::Streaming;
        tracing::info!(
            event = "daemon.streaming",
            iface_id = iface_id,
            "Privileged capture daemon streaming frames"
        );

        let mut write_err: Option<NpError> = None;
        while !self.stop_flag.load(Ordering::Relaxed) {
            match rx.recv() {
                Ok(batch) => {
                    let payload_bytes = batch.encode_payload();
                    let flags = if batch.stats.is_some() {
                        FLAG_STATS_PRESENT
                    } else {
                        0
                    };
                    let header = FrameHeader::new(flags, payload_bytes.len() as u32);
                    let header_bytes = header.to_bytes();

                    if let Err(e) = writer.write_all(&header_bytes) {
                        write_err = Some(NpError::Capability(format!(
                            "Failed writing IPC frame header: {e}"
                        )));
                        break;
                    }
                    if let Err(e) = writer.write_all(&payload_bytes) {
                        write_err = Some(NpError::Capability(format!(
                            "Failed writing IPC frame payload: {e}"
                        )));
                        break;
                    }
                    if let Err(e) = writer.flush() {
                        write_err = Some(NpError::Capability(format!(
                            "Failed flushing IPC stream: {e}"
                        )));
                        break;
                    }
                }
                Err(_) => break, // Capture thread finished or channel closed
            }
        }

        self.stop_flag.store(true, Ordering::Relaxed);
        let _ = capture_handle.join();

        if let Some(err) = write_err {
            self.state = DaemonState::CaptureError;
            Err(err)
        } else {
            self.state = DaemonState::Stopped;
            tracing::info!(
                event = "daemon.stopped",
                "Privileged capture daemon stopped cleanly"
            );
            Ok(())
        }
    }
}

/// Dedicated high-priority synchronous packet capture worker thread loop.
fn capture_worker_loop(
    iface_id: u16,
    capacity: usize,
    max_batch_size: usize,
    stop: Arc<AtomicBool>,
    tx: SyncSender<BinaryFrameBatch>,
) {
    let mut capture_source = match netpulse_platform::open_capture(iface_id) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(
                event = "daemon.capture_open_failed",
                error = %e,
                "Failed to open live capture device"
            );
            return;
        }
    };

    let mut shed_controller = ShedController::new(capacity);
    let mut batch_seq_num = 0u64;
    let mut frame_seq_num = 0u64;
    let mut last_dropped_count = 0u64;
    let mut buffer_len = 0usize;

    while !stop.load(Ordering::Relaxed) {
        let raw_batch = match capture_source.next_batch() {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(
                    event = "daemon.next_batch_failed",
                    error = %e,
                    "Live capture handle error"
                );
                break;
            }
        };

        if raw_batch.is_empty() {
            continue;
        }

        buffer_len = buffer_len.saturating_add(raw_batch.len()).min(capacity);
        let current_stage = shed_controller.update(buffer_len);

        let (rx_count, kernel_drops) = capture_source.stats();
        let stats_changed = kernel_drops != last_dropped_count;
        last_dropped_count = kernel_drops;

        let mut binary_frames = Vec::with_capacity(raw_batch.len().min(max_batch_size));
        for mut raw_frame in raw_batch {
            if current_stage >= ShedStage::PayloadsOff {
                raw_frame.bytes.truncate(ETH_IPV4_TCP_HEADERS);
            }
            if current_stage == ShedStage::SampleDissection && !shed_controller.should_sample() {
                continue;
            }

            frame_seq_num = frame_seq_num.saturating_add(1);
            let wire_len = raw_frame.bytes.len() as u32;
            binary_frames.push(BinaryFrame {
                frame_seq_num,
                mono_nanos: raw_frame.mono_nanos,
                iface_id: raw_frame.iface_id as u32,
                wire_len,
                caplen: raw_frame.bytes.len() as u32,
                pkt_data: raw_frame.bytes,
            });

            if binary_frames.len() >= max_batch_size {
                batch_seq_num = batch_seq_num.saturating_add(1);
                let stats = if stats_changed {
                    Some(TransportStats {
                        dropped_frames: rx_count.saturating_sub(rx_count),
                        queue_depth: buffer_len as u32,
                        reserved: 0,
                    })
                } else {
                    None
                };

                let batch = BinaryFrameBatch {
                    batch_seq_num,
                    stats,
                    frames: std::mem::take(&mut binary_frames),
                };

                if tx.send(batch).is_err() {
                    return; // Receiver disconnected
                }
            }
        }

        if !binary_frames.is_empty() {
            batch_seq_num = batch_seq_num.saturating_add(1);
            let stats = if stats_changed {
                Some(TransportStats {
                    dropped_frames: kernel_drops,
                    queue_depth: buffer_len as u32,
                    reserved: 0,
                })
            } else {
                None
            };

            let batch = BinaryFrameBatch {
                batch_seq_num,
                stats,
                frames: binary_frames,
            };

            if tx.send(batch).is_err() {
                return;
            }
        }

        buffer_len = buffer_len.saturating_sub(max_batch_size);
    }
}
