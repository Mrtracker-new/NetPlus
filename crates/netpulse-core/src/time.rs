//! Time types.
//!
//! Every captured artifact carries a nanosecond timestamp with both a monotonic
//! reading (for ordering and duration math, immune to wall-clock jumps) and a
//! wall-clock reading (for human display and correlation . See.

use serde::{Deserialize, Serialize};

/// A capture instant: monotonic for ordering, wall-clock for display.
///
/// The pipeline timestamps by *capture time*, not processing time, so the
/// timeline stays truthful even when analysis lags a burst.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Timestamp {
    /// Nanoseconds from a monotonic clock. Use for ordering and deltas.
    pub mono_nanos: u64,
    /// Nanoseconds since the Unix epoch (wall-clock). Use for display only.
    pub wall_nanos: u64,
}

impl Timestamp {
    /// Construct from an explicit monotonic + wall-clock pair.
    pub const fn new(mono_nanos: u64, wall_nanos: u64) -> Self {
        Self {
            mono_nanos,
            wall_nanos,
        }
    }
}
