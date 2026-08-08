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
//!
//! **Status: foundation stub.**
#![forbid(unsafe_code)]

use netpulse_core::telemetry::{init_telemetry, read_env_config};

fn main() {
    let config = read_env_config("netpulse-capture-svc", env!("CARGO_PKG_VERSION"));
    let _handle = match init_telemetry(config) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to initialize telemetry in netpulse-capture-svc: {e}");
            return;
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

    // Stub: interface enumeration is not yet implemented.
    // Referencing the type keeps the platform dependency exercised.
    let _list_fn = netpulse_platform::list_interfaces;
    let _shed = netpulse_capture::ShedStage::None;

    tracing::info!(
        event = "capture.stopped",
        "NetPulse capture service finished execution"
    );
}
