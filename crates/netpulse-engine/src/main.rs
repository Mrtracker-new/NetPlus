//! # netpulse-engine (binary)
//!
//! The analysis process (docs/02 §5.1, docs/04 §3.12). It wires the pipeline —
//! decode → flow → narrative → storage → intel → ai/learn — and serves the
//! Query/Stream API to the UI. Runs at user privilege; it holds no raw-capture
//! capability (that lives in the separate `netpulse-capture-svc` process).
//!
//! **Status: Phase 1 offline pipeline online.** With no arguments it prints the
//! scaffold banner and asserts the privacy-preserving storage default. Given a
//! pcap path it runs the full offline reconstruction (docs/05 §13) and reports
//! the flows and sessions recovered — the same code path integration tests use.
#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    println!(
        "NetPulse engine v{} — Phase 1 capture-core. \
         Query/Stream API v{}. Offline pipeline: capture → decode → flow → storage.",
        env!("CARGO_PKG_VERSION"),
        netpulse_api::API_VERSION,
    );

    // Privacy-preserving storage default is asserted at startup (docs/08 §4).
    debug_assert_eq!(
        netpulse_storage::PayloadPolicy::default(),
        netpulse_storage::PayloadPolicy::MetadataOnly,
    );

    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        println!("usage: netpulse-engine <capture.pcap>   (analyzes a pcap offline)");
        return ExitCode::SUCCESS;
    };

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: cannot read {path}: {e}");
            return ExitCode::FAILURE;
        }
    };

    match netpulse_engine::analyze_pcap(&bytes, 16) {
        Ok((store, report)) => {
            println!(
                "Analyzed {path}: {} frames, {} decoded, {} flows, {} sessions, {} causal links.",
                report.frames_read,
                report.packets_decoded,
                report.flows,
                report.sessions,
                report.causal_links,
            );
            // The pipeline stores metadata only; payloads are never written
            // under the default policy (docs/08 §4).
            debug_assert_eq!(store.payload_records(), 0);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error analyzing {path}: {e}");
            ExitCode::FAILURE
        }
    }
}
