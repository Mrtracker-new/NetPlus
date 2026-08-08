//! # netpulse-capture-svc
//!
//! The small, privileged capture process. It holds elevated
//! capture capability (`CAP_NET_RAW` / BPF / admin) and *nothing else*,
//! exposing only a narrow frame-handoff interface to the analysis engine.
//! Confining privilege here keeps the trusted computing base small: if the
//! large analysis/UI code is compromised, it does not inherently hold capture
//! privileges.
//!
//! Observe-only: the capture backend is a read-only frame stream, wired to no
//! injection API.

#![forbid(unsafe_code)]

use netpulse_capture_svc::{CaptureDaemon, DaemonConfig};
use netpulse_core::telemetry::{init_telemetry, read_env_config};
use std::process::ExitCode;

fn main() -> ExitCode {
    let config = read_env_config("netpulse-capture-svc", env!("CARGO_PKG_VERSION"));
    let _handle = match init_telemetry(config) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to initialize telemetry in netpulse-capture-svc: {e}");
            return ExitCode::FAILURE;
        }
    };

    let root_span = tracing::info_span!(
        "capture_svc_root",
        service = "netpulse-capture-svc",
        version = env!("CARGO_PKG_VERSION"),
        pid = std::process::id()
    );
    let _entered = root_span.enter();

    tracing::info!(
        event = "capture.started",
        version = env!("CARGO_PKG_VERSION"),
        "NetPulse capture service started — Privileged, observe-only"
    );

    let mut args = std::env::args().skip(1);
    let mut daemon_cfg = DaemonConfig::default();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--interface" | "-i" => {
                if let Some(val) = args.next() {
                    daemon_cfg.iface_id = val.parse().unwrap_or(0);
                }
            }
            "--socket" | "-s" => {
                if let Some(val) = args.next() {
                    daemon_cfg.socket_path = val;
                }
            }
            "--capacity" | "-c" => {
                if let Some(val) = args.next() {
                    daemon_cfg.buffer_capacity = val.parse().unwrap_or(50_000);
                }
            }
            _ => {}
        }
    }

    let mut daemon = CaptureDaemon::new(daemon_cfg);
    let stdout = std::io::stdout();

    // Stream framed binary transport batches to stdout/socket stream
    match daemon.run_stream(stdout.lock()) {
        Ok(()) => {
            tracing::info!(
                event = "capture.stopped",
                "NetPulse capture service finished execution cleanly"
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!(
                event = "capture.error",
                error = %e,
                "NetPulse capture service exited with error"
            );
            ExitCode::FAILURE
        }
    }
}
