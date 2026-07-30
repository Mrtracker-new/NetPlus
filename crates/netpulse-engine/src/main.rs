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

use netpulse_core::telemetry::{init_telemetry, read_env_config};
use std::process::ExitCode;

fn main() -> ExitCode {
    let config = read_env_config("netpulse-engine", env!("CARGO_PKG_VERSION"));
    let _telemetry_handle = match init_telemetry(config) {
        Ok(handle) => handle,
        Err(e) => {
            eprintln!("Warning: Failed to initialize telemetry: {e}");
            return ExitCode::FAILURE;
        }
    };

    let root_span = tracing::info_span!(
        "engine_root",
        service = "netpulse-engine",
        version = env!("CARGO_PKG_VERSION"),
        pid = std::process::id()
    );
    let _entered = root_span.enter();

    tracing::info!(
        event = "engine.start",
        version = env!("CARGO_PKG_VERSION"),
        api_version = netpulse_api::API_VERSION,
        "NetPulse engine started — Phase 1 capture-core"
    );

    let health_config = netpulse_core::health::read_env_health_config();
    let health_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if health_config.enabled {
        let tracker = std::sync::Arc::new(netpulse_core::health::AtomicHealthTracker::default());
        let provider = std::sync::Arc::new(netpulse_core::health::CompositeHealthProvider::new(
            "netpulse-engine",
            env!("CARGO_PKG_VERSION"),
            tracker,
        ));
        let _health_thread = netpulse_core::health::spawn_health_server(
            health_config,
            provider,
            health_stop.clone(),
        )
        .ok();
    }

    // Privacy-preserving storage default is asserted at startup (docs/08 §4).
    debug_assert_eq!(
        netpulse_storage::PayloadPolicy::default(),
        netpulse_storage::PayloadPolicy::MetadataOnly,
    );

    let mut args = std::env::args().skip(1);
    let Some(first_arg) = args.next() else {
        tracing::info!(
            "usage: netpulse-engine <capture.pcap> | migrate <status|run|validate> [--db <path>]"
        );
        return ExitCode::SUCCESS;
    };

    if first_arg == "migrate" {
        return handle_migrate(args);
    }

    let path = first_arg;

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(
                event = "engine.read_failed",
                path = %path,
                error = %e,
                "Failed to read pcap file"
            );
            return ExitCode::FAILURE;
        }
    };

    match netpulse_engine::analyze_pcap(&bytes, 16) {
        Ok((store, report)) => {
            tracing::info!(
                event = "pipeline.analysis_completed",
                path = %path,
                frames_read = report.frames_read,
                packets_decoded = report.packets_decoded,
                flows_created = report.flows,
                sessions_created = report.sessions,
                causal_links = report.causal_links,
                "Analyzed pcap successfully"
            );
            // The pipeline stores metadata only; payloads are never written
            // under the default policy (docs/08 §4).
            debug_assert_eq!(store.payload_records(), 0);
            ExitCode::SUCCESS
        }
        Err(e) => {
            tracing::error!(
                event = "pipeline.analysis_failed",
                path = %path,
                error = %e,
                "Failed to analyze pcap file"
            );
            ExitCode::FAILURE
        }
    }
}

fn handle_migrate(mut args: impl Iterator<Item = String>) -> ExitCode {
    let subcmd = args.next().unwrap_or_else(|| "status".to_string());
    let mut db_path = netpulse_storage::default_db_path();

    while let Some(arg) = args.next() {
        if arg == "--db" {
            if let Some(custom) = args.next() {
                db_path = std::path::PathBuf::from(custom);
            }
        }
    }

    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error initializing tokio runtime: {e}");
            return ExitCode::FAILURE;
        }
    };

    rt.block_on(async move {
        match subcmd.as_str() {
            "status" => {
                let repo = match netpulse_storage::SqliteCaptureRepository::connect(&db_path).await
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("Error connecting to database at {}: {e}", db_path.display());
                        return ExitCode::FAILURE;
                    }
                };
                match netpulse_storage::MigrationManager::status(repo.pool()).await {
                    Ok(status) => {
                        println!("Database: {}", db_path.display());
                        println!(
                            "Schema Version : {}",
                            status
                                .current_version
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "None".to_string())
                        );
                        println!("Latest Version : {}", status.latest_version);
                        if status.pending.is_empty() {
                            println!("Status         : Up-to-date");
                        } else {
                            println!("Status         : Pending");
                            println!("\nPending migrations:");
                            for p in &status.pending {
                                println!("  - {p}");
                            }
                        }
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("Error fetching migration status: {e}");
                        ExitCode::FAILURE
                    }
                }
            }
            "run" => {
                println!("Running migrations on database: {}", db_path.display());
                match netpulse_storage::SqliteCaptureRepository::connect(&db_path).await {
                    Ok(_) => {
                        println!("Successfully applied all pending migrations.");
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("Failed to apply migrations: {e}");
                        ExitCode::FAILURE
                    }
                }
            }
            "validate" => {
                println!("Validating schema on database: {}", db_path.display());
                let repo = match netpulse_storage::SqliteCaptureRepository::connect(&db_path).await
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("Error connecting to database: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                match netpulse_storage::MigrationManager::validate(repo.pool()).await {
                    Ok(()) => {
                        println!("Schema validation and PRAGMA integrity check passed cleanly.");
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("Schema validation failed: {e}");
                        ExitCode::FAILURE
                    }
                }
            }
            other => {
                eprintln!("Unknown migrate subcommand: {other}");
                eprintln!("Usage: netpulse-engine migrate <status|run|validate> [--db <path>]");
                ExitCode::FAILURE
            }
        }
    })
}
