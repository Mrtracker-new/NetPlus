//! The animation **model** (docs/16 §5) — the data-driven, timed, typed visual
//! events that a renderer turns into motion. This crate owns the *model*, not
//! the pixels: per docs/16 §10, the model is what is asserted deterministically,
//! independent of any GPU/Canvas rendering, which lives in the UI (docs/03 §10).
//!
//! Every rule from docs/16 §3 ("motion with meaning") is enforced at the model:
//! - **Data-driven, not canned** (docs/16 §3): a model is built from real
//!   `ProtoEvent`s / flow metrics — the handshake you watch is *your* handshake
//!   (docs/01 E2). There is no hand-authored sequence.
//! - **Truthful timing** (docs/16 §4.2, §10): the travel time between endpoints
//!   is the *measured* RTT, so a slow handshake feels slow. A test asserts the
//!   animated RTT equals the measured RTT.
//! - **Accessibility is not optional** (docs/16 §8): every model can emit an
//!   equivalent **reduced-motion** step-through that conveys the same events
//!   without continuous motion. Building a model without its static equivalent is
//!   not "done" (docs/16 §11).
//!
//! Styling (protocol colours, shapes) is *not* here — it lives in the shared
//! design system (docs/16 §6, docs/04 §4); the model carries only meaning
//! (direction, timing, the explanation key), never a hue.

use netpulse_decode::ExplanationKey;

/// The concept an animation makes legible (docs/16 §4). Each is driven by
/// specific real data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AnimationKind {
    /// Packets moving between endpoints in real/replayed time (docs/16 §4.1).
    PacketFlow,
    /// A connection/encryption handshake, step-by-step (docs/16 §4.2).
    Handshake,
    /// HTTP/1.1 vs 2 vs 3 concurrency (docs/16 §4.3).
    Multiplexing,
    /// One navigation blossoming into many connections (docs/16 §4.4).
    FanOut,
    /// Loss / retransmission / stalls (docs/16 §4.5).
    Degradation,
}

/// Who sent to whom — the primary meaning motion encodes (docs/16 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Direction {
    ClientToServer,
    ServerToClient,
}

/// One timed, typed visual event (docs/16 §5). `at_nanos` is the offset from the
/// animation's start on the *real* timeline; `key` ties the element to its
/// explanation (docs/07 §7) so the same identifier drives the animation, the
/// lesson, and the explorer (docs/16 §11).
#[derive(Debug, Clone, PartialEq)]
pub struct VisualEvent {
    pub at_nanos: u64,
    pub direction: Direction,
    pub label: String,
    pub key: Option<ExplanationKey>,
}

/// A complete animation model (docs/16 §5): an ordered set of visual events and
/// the total real duration they span.
#[derive(Debug, Clone, PartialEq)]
pub struct AnimationModel {
    pub kind: AnimationKind,
    pub events: Vec<VisualEvent>,
    /// Total span in nanoseconds on the real timeline (docs/16 §5).
    pub total_nanos: u64,
}

impl AnimationModel {
    /// The reduced-motion equivalent (docs/16 §8, a hard requirement): a
    /// step-through list that conveys the *same events* as text, so understanding
    /// never depends on motion being on. One line per visual event, preserving
    /// order, direction, and real timing.
    pub fn reduced_motion_steps(&self) -> Vec<String> {
        self.events
            .iter()
            .map(|e| {
                let who = match e.direction {
                    Direction::ClientToServer => "you → server",
                    Direction::ServerToClient => "server → you",
                };
                let ms = e.at_nanos as f64 / 1_000_000.0;
                format!("{ms:.1} ms · {} ({who})", e.label)
            })
            .collect()
    }
}

/// Build the marquee TCP three-way-handshake animation from the measured RTT
/// (docs/16 §4.2). The travel time each way is `rtt/2`, so SYN→SYN-ACK spans one
/// full RTT and the completing ACK lands at 1.5 RTT — the honest shape of a
/// handshake, with the learner's own timing (docs/16 §4.2, §10).
pub fn tcp_handshake(rtt_nanos: u64) -> AnimationModel {
    let half = rtt_nanos / 2;
    let events = vec![
        VisualEvent {
            at_nanos: 0,
            direction: Direction::ClientToServer,
            label: "SYN".into(),
            key: Some(ExplanationKey("tcp.flags.syn")),
        },
        VisualEvent {
            at_nanos: rtt_nanos,
            direction: Direction::ServerToClient,
            label: "SYN-ACK".into(),
            key: Some(ExplanationKey("tcp.flags.ack")),
        },
        VisualEvent {
            at_nanos: rtt_nanos + half,
            direction: Direction::ClientToServer,
            label: "ACK".into(),
            key: Some(ExplanationKey("tcp.flags.ack")),
        },
    ];
    AnimationModel {
        kind: AnimationKind::Handshake,
        events,
        total_nanos: rtt_nanos + half,
    }
}

/// The measured RTT recoverable from a handshake model: the arrival time of the
/// SYN-ACK (docs/16 §4.2). Used by the truthfulness test — the animated RTT must
/// equal the RTT the flow engine measured (docs/16 §10).
pub fn handshake_rtt_nanos(model: &AnimationModel) -> Option<u64> {
    model
        .events
        .iter()
        .find(|e| e.label == "SYN-ACK")
        .map(|e| e.at_nanos)
}

/// Build a fan-out animation (docs/16 §4.4): one navigation blossoming into
/// connections to many servers over time. `servers` are labels (host/org names
/// from local enrichment, docs/14 §5); `gap_nanos` spaces them so the sequence
/// reads as "one, then another, then another".
pub fn fan_out(servers: &[String], gap_nanos: u64) -> AnimationModel {
    let events: Vec<VisualEvent> = servers
        .iter()
        .enumerate()
        .map(|(i, name)| VisualEvent {
            at_nanos: i as u64 * gap_nanos,
            direction: Direction::ClientToServer,
            label: format!("connect to {name}"),
            key: None,
        })
        .collect();
    let total = events.last().map(|e| e.at_nanos).unwrap_or(0);
    AnimationModel {
        kind: AnimationKind::FanOut,
        events,
        total_nanos: total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_timing_matches_measured_rtt() {
        // Truthfulness (docs/16 §10): the animated RTT equals the measured RTT.
        let measured = 30_000_000; // 30 ms
        let model = tcp_handshake(measured);
        assert_eq!(handshake_rtt_nanos(&model), Some(measured));
        // Three real segments, in order, each keyed to its explanation.
        assert_eq!(model.events.len(), 3);
        assert_eq!(model.events[0].label, "SYN");
        assert_eq!(model.events[0].direction, Direction::ClientToServer);
        assert_eq!(model.events[1].direction, Direction::ServerToClient);
        assert!(model.events.iter().all(|e| e.key.is_some()));
    }

    #[test]
    fn reduced_motion_conveys_the_same_events() {
        // Accessibility (docs/16 §8): the static equivalent has one line per
        // event, conveying direction and timing without motion.
        let model = tcp_handshake(20_000_000);
        let steps = model.reduced_motion_steps();
        assert_eq!(steps.len(), model.events.len());
        assert!(steps[0].contains("SYN"));
        assert!(steps[0].contains("you → server"));
        assert!(steps[1].contains("server → you"));
    }

    #[test]
    fn model_is_deterministic() {
        // Same input → same model (docs/16 §10, replay determinism).
        assert_eq!(tcp_handshake(12_345_678), tcp_handshake(12_345_678));
    }

    #[test]
    fn fan_out_places_one_event_per_server_in_order() {
        let servers = vec!["Cloudflare".to_string(), "Google".to_string()];
        let model = fan_out(&servers, 5_000_000);
        assert_eq!(model.kind, AnimationKind::FanOut);
        assert_eq!(model.events.len(), 2);
        assert_eq!(model.events[0].at_nanos, 0);
        assert_eq!(model.events[1].at_nanos, 5_000_000);
        assert!(model.events[1].label.contains("Google"));
    }
}
