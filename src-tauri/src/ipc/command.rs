use crate::AppState;
use netpulse_api::{Command, CommandResultDto};

/// Execute a control write command against the shell app state.
///
/// The result is a typed [`CommandResultDto`]: commands that touch a file report the
/// artifact they wrote (or opened) so the UI can show the real path instead of an
/// interchangeable success message; everything else answers `Completed`.
#[tracing::instrument(level = "debug", skip(state))]
pub fn execute_command(state: &AppState, command: Command) -> Result<CommandResultDto, String> {
    match command {
        Command::SetDepth { depth } => {
            *state.depth.lock().map_err(|_| "state poisoned")? = crate::to_depth(depth);
            let handle = match state.app_handle.lock() {
                Ok(g) => g.clone(),
                Err(p) => p.into_inner().clone(),
            };
            let capture_running = state.capture.lock().map(|g| g.is_some()).unwrap_or(false);
            crate::emit_live_snapshot(
                &state.store,
                &state.stats,
                &state.depth,
                &state.correlator,
                &state.sockets,
                &handle,
                capture_running,
                None,
            );
            Ok(CommandResultDto::Completed)
        }
        Command::StartLesson { lesson_id } => {
            let mut progress_store = state.progress_store.lock().map_err(|_| "state poisoned")?;
            progress_store.mark_started(&lesson_id);
            state.save_progress(&progress_store);
            Ok(CommandResultDto::Completed)
        }
        Command::SubmitExerciseChoice {
            lesson_id,
            exercise_id,
            choice_index,
        } => {
            let mut progress_store = state.progress_store.lock().map_err(|_| "state poisoned")?;
            if netpulse_engine::education::validate_choice(
                &mut progress_store,
                &lesson_id,
                &exercise_id,
                choice_index,
            )
            .is_some()
            {
                state.save_progress(&progress_store);
                Ok(CommandResultDto::Completed)
            } else {
                Err(format!(
                    "invalid exercise '{exercise_id}' in lesson '{lesson_id}'"
                ))
            }
        }
        Command::ResetLearningProgress => {
            let mut progress_store = state.progress_store.lock().map_err(|_| "state poisoned")?;
            progress_store.reset();
            state.save_progress(&progress_store);
            Ok(CommandResultDto::Completed)
        }
        Command::StartCapture { iface_id } => {
            crate::start_capture(state, iface_id).map(|_| CommandResultDto::Completed)
        }
        Command::StopCapture { .. } => {
            crate::stop_capture(state).map(|_| CommandResultDto::Completed)
        }
        Command::StartRecording => {
            crate::start_recording(state).map(|_| CommandResultDto::Completed)
        }
        Command::StopRecording => crate::stop_recording(state).map(|_| CommandResultDto::Completed),
        Command::ReplayPlay
        | Command::ReplayPause
        | Command::ReplayStep
        | Command::ReplaySeek { .. }
        | Command::ReplaySetSpeed { .. } => {
            let mut replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let Some(ctrl) = replay.as_mut() else {
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
            Ok(CommandResultDto::Completed)
        }
        Command::StartExport {
            selection,
            format,
            level,
        } => crate::run_export(state, selection, format, level)
            .map(|artifact| CommandResultDto::ArtifactWritten { artifact }),
        Command::OpenExport { id } => crate::open_export(state, id)
            .map(|artifact| CommandResultDto::ArtifactOpened { artifact }),
        Command::EnablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.enable(&name) {
                Ok(CommandResultDto::Completed)
            } else {
                Err(format!("cannot enable plugin '{name}'"))
            }
        }
        Command::DisablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.disable(&name) {
                Ok(CommandResultDto::Completed)
            } else {
                Err(format!("unknown plugin '{name}'"))
            }
        }
        Command::ConfigurePlugin { name, config } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry
                .configure_plugin(&name, config)
                .map(|_| CommandResultDto::Completed)
        }
        Command::PatchPluginConfig {
            name,
            expected_version,
            patch,
        } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry
                .patch_plugin(&name, expected_version, patch)
                .map(|_| CommandResultDto::Completed)
        }
        Command::ResetPluginConfig { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry
                .reset_plugin(&name)
                .map(|_| CommandResultDto::Completed)
        }
        _ => Err("unknown command".into()),
    }
}
