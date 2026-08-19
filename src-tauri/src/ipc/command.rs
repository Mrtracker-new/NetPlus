use crate::AppState;
use netpulse_api::Command;

/// Execute a control write command against the shell app state.
#[tracing::instrument(level = "debug", skip(state))]
pub fn execute_command(state: &AppState, command: Command) -> Result<(), String> {
    match command {
        Command::SetDepth { depth } => {
            *state.depth.lock().map_err(|_| "state poisoned")? = crate::to_depth(depth);
            let handle = match state.app_handle.lock() {
                Ok(g) => g.clone(),
                Err(p) => p.into_inner().clone(),
            };
            crate::emit_live_snapshot(&state.store, &state.stats, &state.depth, &handle);
            Ok(())
        }
        Command::StartCapture { iface_id } => crate::start_capture(state, iface_id),
        Command::StopCapture { .. } => crate::stop_capture(state),
        Command::StartRecording => crate::start_recording(state),
        Command::StopRecording => crate::stop_recording(state),
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
            Ok(())
        }
        Command::StartExport { .. } => Ok(()),
        Command::EnablePlugin { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            if registry.enable(&name) {
                Ok(())
            } else {
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
        Command::ConfigurePlugin { name, config } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry.configure_plugin(&name, config)
        }
        Command::PatchPluginConfig {
            name,
            expected_version,
            patch,
        } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry
                .patch_plugin(&name, expected_version, patch)
                .map(|_| ())
        }
        Command::ResetPluginConfig { name } => {
            let mut registry = state.registry.lock().map_err(|_| "state poisoned")?;
            registry.reset_plugin(&name)
        }
        _ => Err("unknown command".into()),
    }
}
