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
//! **Status: foundation stub.** Backends are `unimplemented!` until Phase 1
//! (docs/05, docs/12).
#![forbid(unsafe_code)]

use netpulse_core::traits::CaptureSource;
use netpulse_core::Result;

/// Enumerate capture-capable network interfaces on this host.
///
/// TODO(phase1, docs/05): implement per-OS interface enumeration.
pub fn list_interfaces() -> Result<Vec<Interface>> {
    unimplemented!("interface enumeration — Phase 1, docs/05")
}

/// A capture-capable network interface.
#[derive(Debug, Clone)]
pub struct Interface {
    pub id: u16,
    pub name: String,
}

/// Open a read-only capture backend for `iface` (docs/05).
///
/// TODO(phase1, docs/05): construct the per-OS `CaptureSource`.
pub fn open_capture(_iface: &Interface) -> Result<Box<dyn CaptureSource>> {
    unimplemented!("platform capture backend — Phase 1, docs/05")
}

// Per-OS implementation modules. Empty at foundation stage; each is populated
// behind `#[cfg(target_os)]` in Phase 1 so no cfg leaks above this crate.
#[cfg(target_os = "linux")]
mod linux {}
#[cfg(target_os = "windows")]
mod windows {}
#[cfg(target_os = "macos")]
mod macos {}

#[cfg(test)]
mod tests {
    #[test]
    fn crate_links() {
        // Smoke test: the crate compiles and links into the workspace.
    }
}
