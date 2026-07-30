use crate::AppState;

/// Creates a seeded, deterministic [`AppState`] for IPC integration testing.
#[allow(dead_code)]
pub fn seeded_state() -> AppState {
    AppState::default()
}
