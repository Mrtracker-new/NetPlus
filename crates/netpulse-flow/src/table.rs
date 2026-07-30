//! The flow table: per-flow records with incremental metrics and direction
//! pairing (docs/06 §5), partitioned into shards owned one-thread-each
//! (docs/06 §7). Metrics update in O(1) per packet — no re-scans (docs/06 §10).
//!
//! Identity is `(canonical key, epoch)` (docs/06 §3.2): when a terminal flow's
//! 5-tuple is seen again, a new epoch starts rather than reviving the old flow,
//! so port reuse never merges two connections.

use std::collections::HashMap;

use netpulse_core::net::L4Proto;
use netpulse_core::{Flow, FlowState, ProtoEvent, Timestamp};

use crate::decode_view::PacketView;
use crate::identity::CanonicalKey;
use crate::metrics::MetricsAccumulator;
use crate::state::{advance_tcp, initial_tcp, TcpState};

/// UDP flows with no traffic for this long are considered idle→closed
/// (docs/06 §4.2). Nanoseconds.
pub const UDP_IDLE_NANOS: u64 = 30_000_000_000; // 30s

/// A SYN with no reply for this long is abandoned, not merely slow (docs/06 §4.1).
pub const SYN_ABANDON_NANOS: u64 = 10_000_000_000; // 10s

/// A live per-flow record. Hot fields inline; the rare/large session link is a
/// small `Option` (docs/06 §10, compact per-flow state).
#[derive(Debug, Clone)]
pub struct FlowRecord {
    pub id: u64,
    pub key: CanonicalKey,
    pub epoch: u32,
    pub l4: L4Proto,
    pub first_ts: Timestamp,
    pub last_ts: Timestamp,
    pub tcp_state: Option<TcpState>,
    /// Whether the flow initiator (first-packet sender) is the canonical `lo`
    /// endpoint. Lets later segments be classified as from-initiator or not,
    /// which the TCP state machine needs (docs/06 §3.1, §4.1).
    pub initiator_is_lo: bool,
    pub metrics: MetricsAccumulator,
    /// Protocol events accumulated for this flow, stamped with flow id + ts.
    pub events: Vec<ProtoEvent>,
    /// Set once the flow is attributed to a session (docs/06 §6).
    pub session_id: Option<u64>,
    /// True once finalized and flushed; kept briefly for late packets.
    finalized: bool,
    /// Indicates if the flow was updated since the last dirty snapshot.
    pub dirty: bool,
}

impl FlowRecord {
    /// The public [`FlowState`] of this flow.
    pub fn flow_state(&self) -> FlowState {
        match self.tcp_state {
            Some(ts) => ts.to_flow_state(),
            // UDP/other: datagram until idle-evicted.
            None => FlowState::Datagram,
        }
    }

    /// Whether the flow has reached a terminal state (docs/06 §8).
    pub fn is_closed(&self, now: Timestamp) -> bool {
        match self.tcp_state {
            Some(ts) => ts.is_terminal(),
            None => now.mono_nanos.saturating_sub(self.last_ts.mono_nanos) >= UDP_IDLE_NANOS,
        }
    }

    /// Whether this record has been sealed and flushed (docs/06 §8).
    pub fn is_finalized(&self) -> bool {
        self.finalized
    }

    /// Produce an immutable [`Flow`] snapshot of the flow's current metrics.
    pub fn flow_snapshot(&self) -> Flow {
        Flow {
            id: self.id,
            key: self.metrics.representative_tuple(),
            first_ts: self.first_ts,
            last_ts: self.last_ts,
            l4: self.l4,
            l7: self.metrics.l7(),
            stats: self.metrics.snapshot(),
            state: self.flow_state(),
        }
    }

    /// Seal metrics and produce the immutable [`Flow`] for storage (docs/06 §8).
    pub fn finalize(&mut self) -> Flow {
        self.finalized = true;
        self.flow_snapshot()
    }
}

/// One shard: sole owner of the flows whose key hashes to it (docs/06 §7). No
/// locks are needed because a given flow is only ever touched by its shard.
#[derive(Debug, Default)]
pub struct Shard {
    /// Live flows keyed by (canonical key, epoch).
    flows: HashMap<(CanonicalKey, u32), FlowRecord>,
    /// Latest epoch seen per canonical key, to allocate a fresh one on reuse.
    epochs: HashMap<CanonicalKey, u32>,
}

impl Shard {
    /// Ingest one packet, creating or updating its flow. Returns the flow id the
    /// packet was attributed to.
    pub fn ingest(&mut self, pv: &PacketView, next_id: &mut u64) -> u64 {
        let key = CanonicalKey::from_tuple(&pv.tuple);
        let from_lo = key.is_from_lo(&pv.tuple);

        // Decide the epoch: reuse the current live flow unless it is terminal, in
        // which case a repeat 5-tuple starts a new epoch (docs/06 §3.2).
        let cur_epoch = *self.epochs.get(&key).unwrap_or(&0);
        let start_new = match self.flows.get(&(key, cur_epoch)) {
            Some(f) => f.is_closed(pv.ts),
            None => true,
        };
        let epoch = if start_new && self.flows.contains_key(&(key, cur_epoch)) {
            let e = cur_epoch + 1;
            self.epochs.insert(key, e);
            e
        } else {
            self.epochs.entry(key).or_insert(cur_epoch);
            cur_epoch
        };

        let entry = self.flows.entry((key, epoch)).or_insert_with(|| {
            *next_id += 1;
            let tcp_state = pv.tcp.as_ref().map(initial_tcp);
            FlowRecord {
                id: *next_id,
                key,
                epoch,
                l4: pv.tuple.l4,
                first_ts: pv.ts,
                last_ts: pv.ts,
                tcp_state,
                // The initiator is whoever sent this first packet; remember which
                // canonical side that was so later segments can be classified as
                // from-initiator or not (docs/06 §3.1) — the `lo` side is *not*
                // necessarily the initiator.
                initiator_is_lo: from_lo,
                metrics: MetricsAccumulator::new(key),
                events: Vec::new(),
                session_id: None,
                finalized: false,
                dirty: true,
            }
        });

        // Advance state (skip the very first packet, whose initial state was set
        // at creation). The state machine reasons about the *initiator*, so map
        // this packet's canonical direction onto from-initiator.
        if entry.metrics.total_packets() > 0 {
            if let (Some(state), Some(sig)) = (entry.tcp_state, pv.tcp) {
                let from_initiator = from_lo == entry.initiator_is_lo;
                entry.tcp_state = Some(advance_tcp(state, &sig, from_initiator));
            }
        }

        entry.last_ts = pv.ts;
        entry.metrics.observe(pv, from_lo);
        entry.dirty = true;
        for kind in &pv.events {
            entry.events.push(ProtoEvent {
                flow_id: entry.id,
                ts: pv.ts,
                kind: kind.clone(),
            });
        }
        entry.id
    }

    /// Snapshot only dirty flows that were modified since last call.
    /// Clears the dirty flag on returned flows and drains uncommitted proto events.
    pub fn snapshot_dirty_flows(&mut self) -> Vec<(Flow, Vec<ProtoEvent>)> {
        let mut out = Vec::new();
        for f in self.flows.values_mut() {
            if f.dirty {
                f.dirty = false;
                let snapshot = f.flow_snapshot();
                let events = std::mem::take(&mut f.events);
                out.push((snapshot, events));
            }
        }
        out
    }

    /// Drain all flows that are closed as of `now`, finalizing each (docs/06 §8).
    /// Returns the sealed [`Flow`]s plus their accumulated events for storage.
    pub fn drain_closed(&mut self, now: Timestamp) -> Vec<(Flow, Vec<ProtoEvent>)> {
        let closed: Vec<(CanonicalKey, u32)> = self
            .flows
            .iter()
            .filter(|(_, f)| f.is_closed(now))
            .map(|(k, _)| *k)
            .collect();
        let mut out = Vec::new();
        for k in closed {
            if let Some(mut f) = self.flows.remove(&k) {
                let events = std::mem::take(&mut f.events);
                out.push((f.finalize(), events));
            }
        }
        out
    }

    /// Finalize *every* remaining flow, e.g. at end-of-capture (docs/06 §8).
    pub fn drain_all(&mut self) -> Vec<(Flow, Vec<ProtoEvent>)> {
        self.flows
            .drain()
            .map(|(_, mut f)| {
                let events = std::mem::take(&mut f.events);
                (f.finalize(), events)
            })
            .collect()
    }

    /// Number of live flows in this shard (for eviction/pressure decisions).
    pub fn len(&self) -> usize {
        self.flows.len()
    }

    /// Whether the shard holds no live flows.
    pub fn is_empty(&self) -> bool {
        self.flows.is_empty()
    }
}
