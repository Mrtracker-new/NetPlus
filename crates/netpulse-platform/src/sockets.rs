//! Socket-table attribution backend (docs/12 §4), behind
//! `#[cfg(all(windows, feature = "live-capture"))]`.
//!
//! Maps each connection's 5-tuple to the OS process that owns it, by snapshotting
//! the socket tables (`GetExtendedTcpTable`/`UdpTable` on Windows) via the safe
//! `netstat2` wrapper — so this crate stays `#![forbid(unsafe_code)]` like the
//! capture path. Richer PID identity (name, exe) comes from `sysinfo`, looked up
//! lazily only for PIDs that actually own observed flows (docs/12 §6).
//!
//! Observe-only and read-only: enumerating socket tables inspects OS state; it
//! never touches traffic (docs/01 X1).

use std::sync::Mutex;

use netpulse_core::model::{Process, SocketOwner};
use netpulse_core::net::{FiveTuple, L4Proto};
use netpulse_core::traits::SocketTableSource;
use netpulse_core::Result;

use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// A live [`SocketTableSource`] over the OS socket tables. Holds a `sysinfo`
/// system behind a `Mutex` for interior-mutable lazy process lookups (the trait
/// takes `&self`).
pub struct WindowsSockets {
    system: Mutex<System>,
}

impl std::fmt::Debug for WindowsSockets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WindowsSockets").finish_non_exhaustive()
    }
}

impl WindowsSockets {
    pub fn new() -> Self {
        Self {
            system: Mutex::new(System::new()),
        }
    }
}

impl Default for WindowsSockets {
    fn default() -> Self {
        Self::new()
    }
}

impl SocketTableSource for WindowsSockets {
    fn snapshot(&self) -> Result<Vec<SocketOwner>> {
        let af = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
        let proto = ProtocolFlags::TCP | ProtocolFlags::UDP;
        let sockets = get_sockets_info(af, proto).map_err(|e| {
            netpulse_core::error::NpError::Capability(format!("reading socket tables: {e}"))
        })?;

        let mut owners = Vec::new();
        for si in sockets {
            // A socket with no owning PID (e.g. a system pseudo-socket) can't be
            // attributed — skip rather than invent an owner (docs/12 §8).
            let Some(&pid) = si.associated_pids.first() else {
                continue;
            };
            let tuple = match si.protocol_socket_info {
                ProtocolSocketInfo::Tcp(t) => FiveTuple::new(
                    t.local_addr,
                    t.local_port,
                    t.remote_addr,
                    t.remote_port,
                    L4Proto::Tcp,
                ),
                // UDP is connectionless: the "remote" is unspecified in the table,
                // so we record the local side; the correlator matches on the
                // local (src) endpoint (docs/12 §5.2).
                ProtocolSocketInfo::Udp(u) => {
                    FiveTuple::new(u.local_addr, u.local_port, u.local_addr, 0, L4Proto::Udp)
                }
            };
            owners.push(SocketOwner {
                tuple,
                pid: pid as u64,
                // The socket table exposes no per-socket start time; PID-reuse
                // safety leans on process_info's start time instead (docs/12 §5.3).
                start_mono_nanos: 0,
            });
        }
        Ok(owners)
    }

    fn process_info(&self, pid: u64) -> Result<Option<Process>> {
        let mut system = self.system.lock().map_err(|_| {
            netpulse_core::error::NpError::Invariant("sysinfo mutex poisoned".into())
        })?;
        let sys_pid = Pid::from(pid as usize);
        // Refresh just this PID — cheap, and only done for PIDs that own a flow.
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[sys_pid]),
            true,
            ProcessRefreshKind::nothing(),
        );
        let Some(proc_) = system.process(sys_pid) else {
            return Ok(None);
        };
        let name = proc_.name().to_string_lossy().to_string();
        let exe_path = proc_
            .exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(Some(Process {
            pid,
            name,
            exe_path,
            signer: None,
            // sysinfo reports start time in seconds since epoch; store as ns so
            // the field's unit is consistent, even though it's a wall clock here.
            start_mono_nanos: proc_.start_time().saturating_mul(1_000_000_000),
        }))
    }
}
