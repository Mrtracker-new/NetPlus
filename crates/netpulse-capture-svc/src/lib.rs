//! netpulse-capture-svc library.

pub mod agent;
pub mod transport;

pub use agent::FleetAgent;
pub use transport::{FrameHeader, JsonCodec, CURRENT_VERSION, MAGIC_BYTES};
