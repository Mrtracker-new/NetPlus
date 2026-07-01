//! # netpulse-capture-svc
//!
//! The small, privileged capture process (docs/02 §5.1). It holds elevated
//! capture capability (`CAP_NET_RAW` / BPF / admin) and *nothing else*,
//! exposing only a narrow frame-handoff interface to the analysis engine.
//! Confining privilege here keeps the trusted computing base small: if the
//! large analysis/UI code is compromised, it does not inherently hold capture
//! privileges (docs/02 §5.1, §10.2).
//!
//! Observe-only: the capture backend is a read-only frame stream, wired to no
//! injection API (docs/01 X1, docs/03 §4).
//!
//! **Status: foundation stub.** Real capture lands in Phase 1, docs/05.
#![forbid(unsafe_code)]

fn main() {
    println!(
        "NetPulse capture service v{} — foundation scaffold. \
         Privileged, observe-only. Backends: Phase 1 (see docs/05).",
        env!("CARGO_PKG_VERSION"),
    );
    // Foundation stub: enumerating interfaces is unimplemented until Phase 1.
    // Referencing the type keeps the platform dependency exercised.
    let _list_fn = netpulse_platform::list_interfaces;
    let _shed = netpulse_capture::ShedStage::None;
}
