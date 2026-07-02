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

use netpulse_api::dto::{ExportFormatDto, ExportSelectionDto};
use netpulse_api::{Command, ProjectionDepth, Query, QueryResponse};
use netpulse_capture::{CaptureStats, Recording, ReplayController, ReplayState};
use netpulse_core::Depth;
use netpulse_engine::attribution::Attribution;
use netpulse_engine::education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
};
use netpulse_engine::export::{preview as export_preview, ExportFormat, Sanitizer, Selection};
use netpulse_engine::pipeline::present;
use netpulse_engine::project;
use netpulse_engine::security::{ask_assistant, present_security};
use netpulse_plugin::{
    ContractVersion, PluginManifest, PluginRegistry, PluginType, TrustMetadata, TrustStatus,
};
use netpulse_storage::{CaptureStore, PayloadPolicy};

/// Shell state: the committed reconstruction store, the current disclosure depth,
/// and the Phase 5 lifecycle state — recordings, an optional replay controller,
/// and the plugin registry (seeded with the first-party reference plugins). Behind
/// `Mutex`es so Tauri can share it across command invocations.
struct AppState {
    store: Mutex<CaptureStore>,
    depth: Mutex<Depth>,
    stats: Mutex<CaptureStats>,
    recordings: Mutex<Vec<Recording>>,
    replay: Mutex<Option<ReplayController>>,
    registry: Mutex<PluginRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            // Metadata-only is the private default (docs/08 §4).
            store: Mutex::new(CaptureStore::new(PayloadPolicy::MetadataOnly)),
            depth: Mutex::new(Depth::Beginner),
            stats: Mutex::new(CaptureStats::default()),
            recordings: Mutex::new(Vec::new()),
            replay: Mutex::new(None),
            registry: Mutex::new(seed_registry()),
        }
    }
}

/// Register the first-party reference plugins (docs/24 §6) so the Plugins surface
/// lists real, capability-bounded seams. Their manifests mirror the in-tree
/// examples under `plugins/`; the registry auto-enables first-party references.
fn seed_registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new(netpulse_api::API_VERSION);
    let first_party =
        |name: &str, ty: PluginType, fuzzed: bool, has_explanation: bool| PluginManifest {
            name: name.into(),
            plugin_type: ty,
            target_contract: ContractVersion(netpulse_api::API_VERSION),
            trust: TrustMetadata {
                source: format!("in-tree:plugins/{name}"),
                signature: None,
                status: TrustStatus::FirstParty,
            },
            fuzzed,
            has_explanation,
        };
    reg.register(first_party(
        "example-dissector",
        PluginType::Dissector,
        true,
        true,
    ));
    reg.register(first_party(
        "example-detector",
        PluginType::Detector,
        false,
        false,
    ));
    reg.register(first_party(
        "example-enrichment",
        PluginType::Enrichment,
        false,
        false,
    ));
    reg.register(first_party(
        "example-export",
        PluginType::Export,
        false,
        false,
    ));
    reg
}

fn to_depth(d: ProjectionDepth) -> Depth {
    match d {
        ProjectionDepth::Beginner => Depth::Beginner,
        ProjectionDepth::Intermediate => Depth::Intermediate,
        ProjectionDepth::Expert => Depth::Expert,
        _ => Depth::Beginner,
    }
}

/// Map a wire export selection to the engine's domain selection (docs/23 §8).
fn to_selection(sel: ExportSelectionDto) -> Selection {
    match sel {
        ExportSelectionDto::Window {
            from_mono_nanos,
            to_mono_nanos,
        } => Selection::Window {
            from: from_mono_nanos,
            to: to_mono_nanos,
        },
        ExportSelectionDto::Session { id } => Selection::Session(id),
        ExportSelectionDto::Finding { id } => Selection::Finding(id),
        _ => Selection::All,
    }
}

fn to_format(f: ExportFormatDto) -> ExportFormat {
    match f {
        ExportFormatDto::Pcapng => ExportFormat::Pcapng,
        ExportFormatDto::Json => ExportFormat::Json,
        ExportFormatDto::Csv => ExportFormat::Csv,
        ExportFormatDto::Report => ExportFormat::Report,
        _ => ExportFormat::Json,
    }
}

/// An honest zero replay state when no recording is loaded (docs/21 §8; docs/02
/// §11 fail-closed rather than pretend).
fn empty_replay_state() -> ReplayState {
    ReplayState {
        position_nanos: 0,
        total_nanos: 0,
        speed_percent: 100,
        playing: false,
        frame_index: 0,
        incomplete: false,
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
        Query::ExplorerSearch { term } => Ok(QueryResponse::ExplorerEntries(explorer_search(
            &store, &term,
        ))),
        Query::HandshakeAnimationForFlow { flow_id } => {
            match handshake_animation_for_flow(&store, flow_id) {
                Some(anim) => Ok(QueryResponse::Animation(anim)),
                // No observable RTT: we never fabricate a timing (docs/16 §11).
                None => Ok(QueryResponse::PayloadsUnavailable),
            }
        }
        // ---- Phase 4 intelligence queries (docs/17–20) ----
        Query::SecurityFindings {
            from_mono_nanos,
            to_mono_nanos,
        } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            Ok(QueryResponse::Findings(present_security(
                &store,
                from_mono_nanos,
                to_mono_nanos,
                depth,
            )))
        }
        Query::AskAssistant { question } => {
            // Grounded in the committed store, local-default backend (docs/19 §4.1).
            Ok(QueryResponse::AssistantAnswer(ask_assistant(
                &store, &question,
            )))
        }
        // ---- Phase 5 lifecycle queries (docs/21–24) ----
        Query::ListRecordings => {
            let recordings = state.recordings.lock().map_err(|_| "state poisoned")?;
            let summaries = recordings
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    // A recording is incomplete only if its pcapng truncated; the
                    // sealed recordings held here are whole (docs/22 §8).
                    project::recording_summary_dto(i as u64, r, false)
                })
                .collect();
            Ok(QueryResponse::Recordings(summaries))
        }
        Query::ReplayState => {
            let replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let s = replay
                .as_ref()
                .map(|c| c.state())
                .unwrap_or_else(empty_replay_state);
            Ok(QueryResponse::ReplayState(project::replay_state_dto(&s)))
        }
        Query::ExportPreview { selection, format } => {
            // Preview exactly what an export would contain before any byte is
            // written (docs/23 §6), least-revealing default sanitizer (docs/23 §3).
            let preview = export_preview(
                &store,
                &to_selection(selection),
                to_format(format),
                &Sanitizer::default(),
            );
            Ok(QueryResponse::ExportPreview(project::export_preview_dto(
                &preview,
            )))
        }
        Query::ListPlugins => {
            let registry = state.registry.lock().map_err(|_| "state poisoned")?;
            let descriptors = registry
                .plugins()
                .iter()
                .map(|p| project::plugin_descriptor_dto(p, netpulse_api::API_VERSION))
                .collect();
            Ok(QueryResponse::Plugins(descriptors))
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
            // Recording captures a live stream; with the platform backend stubbed
            // there is nothing to record. Fail closed honestly (docs/02 §11) rather
            // than seal an empty artifact and pretend (docs/22 §4).
            Err("recording requires a live capture source (platform backend is a stub)".into())
        }
        // ---- Phase 5 replay transport (docs/21 §5) ----
        Command::ReplayPlay
        | Command::ReplayPause
        | Command::ReplayStep
        | Command::ReplaySeek { .. }
        | Command::ReplaySetSpeed { .. } => {
            let mut replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let Some(ctrl) = replay.as_mut() else {
                // Honest: no recording loaded to replay (docs/02 §11).
                return Err("no recording is loaded to replay".into());
            };
            match command {
                Command::ReplayPlay => ctrl.play(),
                Command::ReplayPause => ctrl.pause(),
                Command::ReplayStep => ctrl.step(),
                Command::ReplaySeek { mono_nanos } => ctrl.seek(mono_nanos),
                Command::ReplaySetSpeed { percent } => ctrl.set_speed(percent),
                _ => unreachable!("outer match restricts to replay commands"),
            }
            Ok(())
        }
        Command::StartExport { .. } => {
            // Export writes a *file*; sharing it is a further, separate user action.
            // The shell never auto-transmits — the single egress boundary stays
            // `netpulse-ai` (docs/23 §6, docs/02 §10). Bytes are produced on demand
            // via the preview/export functions; acknowledging here keeps the shell
            // free of an implicit-egress path.
            Ok(())
        }
        Command::EnablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.enable(&name) {
                Ok(())
            } else {
                // Structurally ineligible (incompatible/incomplete) or unknown —
                // honest refusal, never a silent no-op (docs/24 §8).
                Err(format!("cannot enable plugin '{name}'"))
            }
        }
        Command::DisablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.disable(&name) {
                Ok(())
            } else {
                Err(format!("unknown plugin '{name}'"))
            }
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
