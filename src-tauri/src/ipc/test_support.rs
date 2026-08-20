use crate::AppState;
use std::sync::{Arc, Mutex};

/// Creates a seeded, deterministic [`AppState`] for IPC integration testing with isolated progress state.
#[allow(dead_code)]
pub fn seeded_state() -> AppState {
    let mut state = AppState::default();
    let temp_file = std::env::temp_dir().join(format!(
        "netpulse_test_learn_seeded_{}_{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    state.progress_path = Some(temp_file);
    state.progress_store = Arc::new(Mutex::new(netpulse_learn::ProgressStore::new()));
    state
}
