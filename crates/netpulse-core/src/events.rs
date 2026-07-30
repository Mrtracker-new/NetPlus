//! Standardized System Event Envelope.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemEventEnvelope<T> {
    pub event_id: String,
    pub timestamp_nanos: u64,
    pub source: String,
    pub kind: String,
    pub payload: T,
}

impl<T> SystemEventEnvelope<T> {
    pub fn new(source: impl Into<String>, kind: impl Into<String>, payload: T) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        Self {
            event_id: format!("evt-{}", nanos),
            timestamp_nanos: nanos,
            source: source.into(),
            kind: kind.into(),
            payload,
        }
    }
}
