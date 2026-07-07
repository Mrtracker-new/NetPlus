//! # netpulse-platform
//!
//! The single home for OS-specific code (docs/03 §13, docs/04 §3.2). Everything
//! above this crate — decode, flow, session, storage, intelligence, UI — is
//! platform-neutral. Porting to a new OS touches only this crate.
//!
//! Capture backends (`AF_PACKET`/Npcap/BPF) and attribution sources
//! (`/proc`+netlink, `iphlpapi`, `libproc`) are gated by `#[cfg(target_os)]`
//! and reached only through the traits below. A CI lint (docs/04 §7) flags any
//! `cfg(target_os)` that leaks into another crate.
//!
//! **Live capture** is implemented for Windows via Npcap behind the
//! `live-capture` feature (off by default, so the standard build stays
//! dependency-free — docs/03 §14). When the feature is off, or on an OS without
//! a backend yet, the functions fail closed with a [`NpError::Capability`]
//! rather than pretend (docs/02 §11).
#![forbid(unsafe_code)]

use netpulse_core::Result;
// Only the fallback path references these directly; the live build routes through
// the `npcap` module (which imports its own), so gate them to avoid unused-import
// warnings there.
#[cfg(not(all(windows, feature = "live-capture")))]
use netpulse_core::error::NpError;
#[cfg(not(all(windows, feature = "live-capture")))]
use netpulse_core::traits::{CaptureSource, RawFrame};

/// A capture-capable network interface.
#[derive(Debug, Clone)]
pub struct Interface {
    /// Stable index into the enumeration; used to reopen the same adapter.
    pub id: u16,
    /// The OS device name (e.g. an `\Device\NPF_{GUID}` on Windows).
    pub name: String,
    /// A human-friendly description when the OS provides one.
    pub description: Option<String>,
}

use std::sync::Arc;

use netpulse_core::traits::SocketTableSource;

// Host-environment name hints (hosts file + OS resolver cache). Pure-std and
// egress-free, so it is always available — no `live-capture` gate — and portable
// across OSes (the resolver-cache reader is Windows-only inside; other platforms
// contribute only hosts-file entries).
pub mod names;
pub use names::host_name_hints;

// The real backend is compiled only when live capture is both requested
// (`live-capture`) and available for the target OS (Windows/Npcap today).
#[cfg(all(windows, feature = "live-capture"))]
mod npcap;
#[cfg(all(windows, feature = "live-capture"))]
pub use npcap::LiveCapture;

#[cfg(all(windows, feature = "live-capture"))]
mod sockets;

/// A shared, live socket→process attribution source (docs/12 §4), or `None` where
/// no backend is available (feature off / unsupported OS) — attribution then
/// stays honestly `Unknown` rather than guessing (docs/12 §8).
#[cfg(all(windows, feature = "live-capture"))]
pub fn socket_table() -> Option<Arc<dyn SocketTableSource + Send + Sync>> {
    Some(Arc::new(sockets::WindowsSockets::new()))
}

/// Fallback: no socket-table backend in this build.
#[cfg(not(all(windows, feature = "live-capture")))]
pub fn socket_table() -> Option<Arc<dyn SocketTableSource + Send + Sync>> {
    None
}

/// Enumerate capture-capable network interfaces on this host.
#[cfg(all(windows, feature = "live-capture"))]
pub fn list_interfaces() -> Result<Vec<Interface>> {
    npcap::list_interfaces()
}

/// Open a live, read-only capture on the interface with the given [`Interface::id`].
#[cfg(all(windows, feature = "live-capture"))]
pub fn open_capture(iface_id: u16) -> Result<LiveCapture> {
    npcap::open_capture(iface_id)
}

// ---- Fallback: feature off, or an OS without a backend yet. ----
// The same public surface exists so the engine/shell compile unchanged; every
// entry point fails closed honestly (docs/02 §11).
#[cfg(not(all(windows, feature = "live-capture")))]
pub use disabled::LiveCapture;

#[cfg(not(all(windows, feature = "live-capture")))]
mod disabled {
    use super::*;

    fn unavailable() -> NpError {
        NpError::Capability(
            "live capture is not available in this build (enable the `live-capture` \
             feature on Windows with Npcap installed)"
                .into(),
        )
    }

    pub fn list_interfaces() -> Result<Vec<Interface>> {
        Err(unavailable())
    }

    pub fn open_capture(_iface_id: u16) -> Result<LiveCapture> {
        Err(unavailable())
    }

    /// A never-constructed stand-in so signatures line up when live capture is
    /// compiled out. `open_capture` always errors before one could exist.
    #[derive(Debug)]
    pub struct LiveCapture(());

    impl LiveCapture {
        /// libpcap link-layer type (DLT); unreachable in this build.
        pub fn link_dlt(&self) -> u32 {
            1
        }
        /// (received, dropped) frame counts; unreachable in this build.
        pub fn stats(&mut self) -> (u64, u64) {
            (0, 0)
        }
    }

    impl CaptureSource for LiveCapture {
        fn next_batch(&mut self) -> Result<Vec<RawFrame>> {
            Ok(Vec::new())
        }
    }
}

#[cfg(not(all(windows, feature = "live-capture")))]
pub use disabled::{list_interfaces, open_capture};

// Per-OS attribution/capture modules land here behind `#[cfg(target_os)]` so no
// cfg leaks above this crate (docs/04 §7). macOS/Linux capture backends TODO.
#[cfg(target_os = "linux")]
mod linux {}
#[cfg(target_os = "macos")]
mod macos {}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {
        // Smoke test: the crate compiles and links into the workspace.
    }

    // Without the live-capture feature the entry points must fail closed, never
    // panic (docs/02 §11).
    #[cfg(not(all(windows, feature = "live-capture")))]
    #[test]
    fn disabled_fails_closed() {
        assert!(super::list_interfaces().is_err());
        assert!(super::open_capture(0).is_err());
    }
}
