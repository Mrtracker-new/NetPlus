//! IPC query and command execution module for NetPulse Tauri shell (docs/02 §7.1).

pub mod command;
pub mod query;
pub mod test_support;

#[cfg(test)]
mod tests;

pub use command::execute_command;
pub use query::execute_query;
