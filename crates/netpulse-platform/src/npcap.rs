//! Windows live capture backend, via Npcap (libpcap-compatible) behind the
//! `pcap` crate (docs/05 §5, docs/03 §13). Compiled only under
//! `#[cfg(all(windows, feature = "live-capture"))]`.
//!
//! Observe-only (docs/01 X1): the capture handle is a read-only frame stream —
//! it is wired to no injection API. All FFI `unsafe` is encapsulated by the
//! `pcap` crate, so this module (and the crate) stay `#![forbid(unsafe_code)]`.
//!
//! Prerequisites at runtime: Npcap installed (WinPcap-compatible mode) and the
//! process running elevated. Missing either surfaces as a
//! [`NpError::Capability`] from [`open_capture`], never a panic (docs/02 §11).

use netpulse_core::error::NpError;
use netpulse_core::traits::{CaptureSource, RawFrame};
use netpulse_core::Result;

use pcap::{Active, Capture, ConnectionStatus, Device, Error as PcapError};

use super::Interface;

/// Rank a device as a default-capture candidate: higher is better. Prefers an
/// interface that is connected, up, running, and has an address — i.e. the one
/// actually carrying the user's traffic. This replaces `pcap_lookupdev`, which
/// is deprecated and unreliable on Windows/Npcap.
fn default_score(d: &Device) -> u8 {
    let mut score = 0;
    if d.flags.is_up() {
        score += 1;
    }
    if d.flags.is_running() {
        score += 2;
    }
    if !d.addresses.is_empty() {
        score += 4;
    }
    if d.flags.connection_status == ConnectionStatus::Connected {
        score += 8;
    }
    score
}

/// Frames pulled per `next_batch` before yielding, bounding the batch so a busy
/// link can't starve the stop check in the live loop (docs/05 §4.2).
const MAX_BATCH: usize = 512;
/// Kernel→user read timeout. With immediate mode on, packets arrive promptly;
/// the timeout bounds how long an idle capture blocks before the caller can
/// re-check its stop flag (docs/05 §4).
const READ_TIMEOUT_MS: i32 = 500;
/// Full frames — we snaplen to the max Ethernet-ish frame; the pipeline's own
/// shedding, not truncation here, governs payload retention (docs/05 §9).
const SNAPLEN: i32 = 65_535;

fn cap_err(context: &str, e: PcapError) -> NpError {
    NpError::Capability(format!("{context}: {e}"))
}

/// Enumerate capture devices in a single canonical order, best-candidate first
/// (by [`default_score`]). Both [`list_interfaces`] and [`open_capture`] use this
/// one ordering so a listed `id` always maps to the same device — they can never
/// drift. Ordering is stable: equal scores keep OS enumeration order.
fn ordered_devices() -> Result<Vec<Device>> {
    let mut devices =
        Device::list().map_err(|e| cap_err("enumerating interfaces (is Npcap installed?)", e))?;
    // Stable sort, highest score first (negate to reverse without unstable sort).
    devices.sort_by_key(|d| std::cmp::Reverse(default_score(d)));
    Ok(devices)
}

/// Enumerate capture-capable interfaces, best-candidate first. Ids are **1-based**
/// so `0` is reserved, unambiguously, for "let the platform pick the default"
/// (see [`open_capture`]).
pub fn list_interfaces() -> Result<Vec<Interface>> {
    Ok(ordered_devices()?
        .into_iter()
        .enumerate()
        .map(|(i, d)| Interface {
            id: (i + 1) as u16,
            name: d.name,
            description: d.desc,
        })
        .collect())
}

/// Open a live capture. `iface_id == 0` picks the best-scoring non-loopback
/// adapter; a positive id selects that entry from [`list_interfaces`] (1-based).
/// Promiscuous + immediate mode for a complete, low-latency stream. Fails closed
/// if Npcap is absent or privileges are insufficient.
pub fn open_capture(iface_id: u16) -> Result<LiveCapture> {
    let devices = ordered_devices()?;

    let device = if iface_id == 0 {
        // Best-scoring non-loopback interface is first after the sort.
        devices
            .into_iter()
            .find(|d| !d.flags.is_loopback())
            .ok_or_else(|| {
                NpError::Capability(
                    "no active non-loopback capture interface found (is anything connected?)"
                        .into(),
                )
            })?
    } else {
        devices
            .into_iter()
            .nth((iface_id - 1) as usize)
            .ok_or_else(|| {
                NpError::Capability(format!("no capture interface with id {iface_id}"))
            })?
    };

    let capture = Capture::from_device(device)
        .map_err(|e| cap_err("selecting capture device", e))?
        .promisc(true)
        .immediate_mode(true)
        .snaplen(SNAPLEN)
        .timeout(READ_TIMEOUT_MS)
        .open()
        .map_err(|e| cap_err("opening capture (Npcap installed? running elevated?)", e))?;

    let dlt = capture.get_datalink().0 as u32;
    Ok(LiveCapture {
        capture,
        dlt,
        iface_id,
        base_wall_nanos: None,
    })
}

/// A live [`CaptureSource`] over an open Npcap handle. Yields [`RawFrame`]s in
/// the same shape the file source does (docs/05 §12) — capture-time monotonic
/// timestamp derived from the first frame's wall clock — so the *identical*
/// downstream pipeline reconstructs live and offline traffic alike (docs/21 §4).
pub struct LiveCapture {
    capture: Capture<Active>,
    dlt: u32,
    iface_id: u16,
    /// Wall-clock ns of the first frame, so monotonic readings start at 0 and
    /// durations are correct regardless of the absolute epoch (docs/05 §6).
    base_wall_nanos: Option<u64>,
}

impl std::fmt::Debug for LiveCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveCapture")
            .field("dlt", &self.dlt)
            .field("iface_id", &self.iface_id)
            .finish_non_exhaustive()
    }
}

impl LiveCapture {
    /// The libpcap link-layer type (DLT) of this interface, so the caller can
    /// configure the decoder (docs/07 §4.2). 1 = Ethernet, the common case.
    pub fn link_dlt(&self) -> u32 {
        self.dlt
    }

    /// Honest capture accounting as `(received, dropped)` since the handle opened
    /// (docs/05 §3, §9): kernel-ring drops are truth loss and must be surfaced.
    pub fn stats(&mut self) -> (u64, u64) {
        match self.capture.stats() {
            Ok(s) => (s.received as u64, s.dropped as u64),
            Err(_) => (0, 0),
        }
    }
}

impl CaptureSource for LiveCapture {
    fn next_batch(&mut self) -> Result<Vec<RawFrame>> {
        let mut batch = Vec::new();
        // Blocking drain: the first read blocks up to the timeout; once frames
        // flow, subsequent reads return promptly until the ring drains, then one
        // read times out and we yield the batch (docs/05 §4.2).
        while batch.len() < MAX_BATCH {
            match self.capture.next_packet() {
                Ok(packet) => {
                    let wall_nanos = (packet.header.ts.tv_sec as u64)
                        .wrapping_mul(1_000_000_000)
                        .wrapping_add((packet.header.ts.tv_usec as u64).wrapping_mul(1_000));
                    let base = *self.base_wall_nanos.get_or_insert(wall_nanos);
                    batch.push(RawFrame {
                        mono_nanos: wall_nanos.saturating_sub(base),
                        iface_id: self.iface_id,
                        bytes: packet.data.to_vec(),
                    });
                }
                // No frame within the timeout — a clean, expected idle boundary.
                Err(PcapError::TimeoutExpired) => break,
                // Source closed / end of a (finite) source.
                Err(PcapError::NoMorePackets) => break,
                Err(e) => return Err(cap_err("reading from capture", e)),
            }
        }
        Ok(batch)
    }
}
