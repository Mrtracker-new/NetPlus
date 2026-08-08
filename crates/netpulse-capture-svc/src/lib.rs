//! netpulse-capture-svc library.

pub mod agent;
pub mod client;
pub mod daemon;
pub mod transport;

pub use agent::FleetAgent;
pub use client::IpcCaptureSource;
pub use daemon::{CaptureDaemon, DaemonConfig, DaemonState};
pub use transport::{
    BinaryFrame, BinaryFrameBatch, BinaryFrameBatchView, BinaryFrameCodec, BinaryFrameView,
    FrameHeader, JsonCodec, TransportStats, CURRENT_VERSION, FLAG_STATS_PRESENT, MAGIC_BYTES,
    MAX_PAYLOAD_LEN,
};
