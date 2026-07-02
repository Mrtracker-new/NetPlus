//! The NetPulse desktop shell (docs/03 §8). Tauri hosts the React webview and
//! exposes exactly two commands — `query` and `command` — that carry the
//! enumerated `netpulse-api` surface. The webview can invoke nothing else, so
//! the observe-only guarantee is trivially auditable (docs/02 §10): there is no
//! IPC path that modifies traffic.
//!
//! This shell is intentionally thin. All analysis lives in `netpulse-engine`;
//! the shell only owns the committed store and maps a [`Query`] to a
//! [`QueryResponse`] over the engine's read-only presentation view (docs/11
//! §14). Live capture is not wired here because the per-OS capture backend is
//! still a documented stub in `netpulse-platform` (docs/05, Phase 1 memo), so
//! `StartCapture` refuses honestly rather than pretending (docs/02 §11: fail
//! closed on missing capability).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use std::sync::Mutex;

use netpulse_api::{Command, ProjectionDepth, Query, QueryResponse};
use netpulse_capture::CaptureStats;
use netpulse_core::Depth;
use netpulse_engine::attribution::Attribution;
use netpulse_engine::education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
};
use netpulse_engine::pipeline::present;
use netpulse_engine::project;
use netpulse_storage::{CaptureStore, PayloadPolicy};

/// Shell state: the committed reconstruction store and the current disclosure
/// depth. Behind a `Mutex` so Tauri can share it across command invocations.
struct AppState {
    store: Mutex<CaptureStore>,
    depth: Mutex<Depth>,
    stats: Mutex<CaptureStats>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            // Metadata-only is the private default (docs/08 §4).
            store: Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)),
            depth: Mutex::new(Depth::Beginner),
            stats: Mutex::new(CaptureStats::default()),
        }
    }
}

fn to_depth(d: ProjectionDepth) -> Depth {
    match d {
        ProjectionDepth::Beginner => Depth::Beginner,
        ProjectionDepth::Intermediate => Depth::Intermediate,
        ProjectionDepth::Expert => Depth::Expert,
        _ => Depth::Beginner,
    }
}

/// The single pull entry point (docs/02 §7.1). Every historical/aggregated read
/// the UI performs comes through here and is answered from the committed store.
#[tauri::command]
fn query(query: Query, state: tauri::State<'_, AppState>) -> Result<QueryResponse, String> {
    let store = state.store.lock().map_err(|_| "state poisoned")?;
    let stats = *state.stats.lock().map_err(|_| "state poisoned")?;
    match query {
        Query::NarrativeFeed { depth, .. } => {
            let view = present(&store, to_depth(depth), stats);
            Ok(QueryResponse::NarrativeFeed(view.narratives))
        }
        Query::MonitorSnapshot { .. } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            let view = present(&store, depth, stats);
            Ok(QueryResponse::MonitorSnapshot(view.monitor))
        }
        Query::JourneyOfSession { session_id, depth } => {
            let view = present(&store, to_depth(depth), stats);
            // The journey is the sentences of the card summarizing that session.
            let sentences = view
                .narratives
                .into_iter()
                .find(|c| {
                    c.evidence
                        .iter()
                        .any(|e| matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id))
                })
                .map(|c| {
                    let mut s = vec![c.headline];
                    s.extend(c.lines);
                    s
                })
                .unwrap_or_default();
            Ok(QueryResponse::Journey(sentences))
        }
        Query::AttributionOfFlow { .. } => {
            // No live SocketTableSource is wired in this build (docs/12 §4 stub),
            // so attribution is honestly Unknown rather than guessed (docs/12 §8).
            Ok(QueryResponse::Attribution(project::attribution_dto(
                &Attribution::unknown(),
                None,
            )))
        }
        Query::PacketsOfFlow { .. } => {
            // Metadata-only store: raw bytes were never retained (docs/09 §8).
            Ok(QueryResponse::PayloadsUnavailable)
        }
        // ---- Phase 3 education queries (docs/13–16) ----
        Query::LessonOffers { session_id, depth } => {
            // Grounded offers for this session's teachable moments (docs/13 §4):
            // filter the education view to offers that cite this session.
            let view = present_education(&store, to_depth(depth));
            let offers = view
                .offers
                .into_iter()
                .filter(|o| {
                    o.evidence.iter().any(|e| {
                        matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id)
                    })
                })
                .collect();
            Ok(QueryResponse::LessonOffers(offers))
        }
        Query::JourneyStagesOfSession { session_id, depth } => {
            let view = present_education(&store, to_depth(depth));
            let journey = view
                .journeys
                .into_iter()
                .find(|j| j.session_id == session_id)
                .unwrap_or(netpulse_api::PageJourneyDto {
                    session_id,
                    stages: Vec::new(),
                    fanout: Vec::new(),
                });
            Ok(QueryResponse::PageJourney(journey))
        }
        Query::ExplorerBrowse => Ok(QueryResponse::ExplorerEntries(explorer_browse(&store))),
        Query::ExplorerSearch { term } => {
            Ok(QueryResponse::ExplorerEntries(explorer_search(&store, &term)))
        }
        Query::HandshakeAnimationForFlow { flow_id } => {
            match handshake_animation_for_flow(&store, flow_id) {
                Some(anim) => Ok(QueryResponse::Animation(anim)),
                // No observable RTT: we never fabricate a timing (docs/16 §11).
                None => Ok(QueryResponse::PayloadsUnavailable),
            }
        }
        _ => Ok(QueryResponse::PayloadsUnavailable),
    }
}

/// The single control entry point (docs/02 §7.1) — the only write path UI→engine.
/// Observe-only: nothing here touches network traffic.
#[tauri::command]
fn command(command: Command, state: tauri::State<'_, AppState>) -> Result<(), String> {
    match command {
        Command::SetDepth { depth } => {
            *state.depth.lock().map_err(|_| "state poisoned")? = to_depth(depth);
            Ok(())
        }
        Command::StartCapture { .. } | Command::StopCapture { .. } => {
            // Live capture backend is a documented stub (docs/05); fail closed
            // and honestly rather than pretend to capture (docs/02 §11).
            Err("live capture is not available in this build (platform backend is a stub)".into())
        }
        Command::StartRecording | Command::StopRecording => {
            Err("recording is not available in this build".into())
        }
        _ => Err("unknown command".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![query, command])
        .run(tauri::generate_context!())
        .expect("error while running the NetPulse shell");
}
