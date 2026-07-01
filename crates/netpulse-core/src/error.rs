//! Shared error type for the engine crates.
//!
//! Higher layers add their own context, but this common type keeps the
//! error vocabulary consistent across the dependency graph.

use thiserror::Error;

/// Errors that can arise anywhere in the NetPulse pipeline.
///
/// Variants are intentionally coarse at foundation stage; phase crates extend
/// the taxonomy as concrete failure modes appear.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum NpError {
    /// A packet or message could not be parsed. Partial results may still be
    /// retained at the level that *did* parse (docs/02 §11: fail open on detail).
    #[error("decode error: {0}")]
    Decode(String),

    /// A storage read or write failed.
    #[error("storage error: {0}")]
    Storage(String),

    /// The operation requires a capability (e.g. raw capture) that is missing.
    /// The app degrades to a clear, actionable state rather than crashing
    /// (docs/02 §11: fail closed on privilege).
    #[error("missing capability: {0}")]
    Capability(String),

    /// A value violated an invariant (e.g. a confidence outside 0.0..=1.0).
    #[error("invariant violated: {0}")]
    Invariant(String),
}

/// Convenience alias used throughout the workspace.
pub type Result<T> = std::result::Result<T, NpError>;
