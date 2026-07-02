//! The read-only slice the intelligence layer reasons over (docs/17 §6). A
//! [`TrafficView`] is exactly the committed data a caller (the engine's security
//! projection, docs/11 §14) gathers from storage and hands to the detectors —
//! flows, their protocol events, and any process attribution known for a flow
//! (docs/12). The layer captures, parses, and stores nothing; it only *reads*
//! this view and emits [`crate::SecurityFinding`]s off the hot path (docs/02 §5.2).

use std::collections::HashMap;

use netpulse_core::{Flow, Process, ProtoEvent};

/// A window of committed traffic to assess (docs/17 §6). Borrowed, so building it
/// is cheap and the detectors never own or mutate capture data (observe-only,
/// docs/01 X1).
#[derive(Debug, Clone, Copy)]
pub struct TrafficView<'a> {
    /// The flows in scope, in whatever order storage returned them.
    pub flows: &'a [Flow],
    /// Protocol events across those flows (docs/07). Used by the DNS detector.
    pub events: &'a [ProtoEvent],
    /// Process attributed to a flow id, when the OS gave a confident owner
    /// (docs/12 §5). Empty when no live socket source is wired — detectors that
    /// need it then degrade honestly rather than guess (docs/12 §8).
    pub process_of: &'a HashMap<u64, Process>,
}

impl<'a> TrafficView<'a> {
    /// The process attributed to `flow_id`, if known (docs/12).
    pub fn process(&self, flow_id: u64) -> Option<&'a Process> {
        self.process_of.get(&flow_id)
    }
}
