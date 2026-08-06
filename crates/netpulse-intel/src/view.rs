//! The read-only slice the intelligence layer reasons over. A
//! [`TrafficView`] is exactly the committed data a caller (the engine's security
//! projection gathers from storage and hands to the detectors —
//! flows, their protocol events, and any process attribution known for a flow
//!The layer captures, parses, and stores nothing; it only *reads*
//! this view and emits [`crate::SecurityFinding`]s off the hot path.

use std::collections::HashMap;

use netpulse_core::{Flow, Process, ProtoEvent};

/// A window of committed traffic to assess. Borrowed, so building it
/// is cheap and the detectors never own or mutate capture data (observe-only,
///  .
#[derive(Debug, Clone, Copy)]
pub struct TrafficView<'a> {
    /// The flows in scope, in whatever order storage returned them.
    pub flows: &'a [Flow],
    /// Protocol events across those flows. Used by the DNS detector.
    pub events: &'a [ProtoEvent],
    /// Process attributed to a flow id, when the OS gave a confident owner
    ///Empty when no live socket source is wired — detectors that
    /// need it then degrade honestly rather than guess.
    pub process_of: &'a HashMap<u64, Process>,
}

impl<'a> TrafficView<'a> {
    /// The process attributed to `flow_id`, if known.
    pub fn process(&self, flow_id: u64) -> Option<&'a Process> {
        self.process_of.get(&flow_id)
    }
}
