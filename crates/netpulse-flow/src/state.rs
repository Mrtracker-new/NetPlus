//! Per-flow lifecycle state machines. Different transports have
//! different lifecycles: TCP is connection-oriented with an explicit handshake
//! and teardown (the richest, most diagnostic machine), while UDP is
//! connectionless and inferred from an idle timeout.
//!
//! The machine maps to [`netpulse_core::FlowState`], the shared vocabulary term,
//! but tracks a little more internally (e.g. `SynAckSeen`) so it can measure the
//! connection-setup RTT and distinguish an abandoned SYN from a refused one
//!

use netpulse_core::FlowState;

use crate::decode_view::TcpSignals;

/// The TCP connection state. A superset of [`FlowState`] with the
/// intermediate handshake step the RTT calculation needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TcpState {
    SynSeen,
    SynAckSeen,
    Established,
    FinWait,
    Closing,
    Closed,
    Reset,
    /// SYN with no reply within the abandon timeout — unreachable/dropped.
    Abandoned,
    /// Capture started mid-connection; the handshake was never seen
    ///Setup RTT is unavailable, not wrong.
    JoinedMidStream,
}

impl TcpState {
    /// The public [`FlowState`] projection of this internal state.
    pub fn to_flow_state(self) -> FlowState {
        match self {
            TcpState::SynSeen | TcpState::SynAckSeen => FlowState::SynSeen,
            TcpState::Established | TcpState::JoinedMidStream => FlowState::Established,
            TcpState::FinWait | TcpState::Closing => FlowState::Closing,
            TcpState::Closed | TcpState::Reset | TcpState::Abandoned => FlowState::Closed,
        }
    }

    /// Whether the flow has reached a terminal state and can be finalized
    ///
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TcpState::Closed | TcpState::Reset | TcpState::Abandoned
        )
    }
}

/// Advance the TCP state given the flags on a newly-observed segment and whether
/// it came from the initiator side. Returns the new state.
///
/// This is deliberately tolerant: real captures reorder, retransmit, and start
/// mid-stream. The machine never enters an impossible state and always makes
/// progress toward a terminal one (asserted by property tests in .
pub fn advance_tcp(state: TcpState, sig: &TcpSignals, from_initiator: bool) -> TcpState {
    // A reset ends the conversation from any state.
    if sig.rst {
        return TcpState::Reset;
    }
    match state {
        TcpState::SynSeen => {
            if sig.syn && sig.ack && !from_initiator {
                TcpState::SynAckSeen
            } else if sig.fin {
                TcpState::FinWait
            } else {
                TcpState::SynSeen
            }
        }
        TcpState::SynAckSeen => {
            if sig.ack && from_initiator {
                TcpState::Established
            } else {
                TcpState::SynAckSeen
            }
        }
        TcpState::Established | TcpState::JoinedMidStream => {
            if sig.fin {
                TcpState::FinWait
            } else {
                TcpState::Established
            }
        }
        TcpState::FinWait => {
            if sig.fin {
                TcpState::Closing
            } else {
                TcpState::FinWait
            }
        }
        TcpState::Closing => {
            if sig.ack {
                TcpState::Closed
            } else {
                TcpState::Closing
            }
        }
        // Terminal states are absorbing.
        s @ (TcpState::Closed | TcpState::Reset | TcpState::Abandoned) => s,
    }
}

/// The initial TCP state for a flow's first observed segment.
pub fn initial_tcp(sig: &TcpSignals) -> TcpState {
    if sig.rst {
        TcpState::Reset
    } else if sig.syn && !sig.ack {
        TcpState::SynSeen
    } else if sig.syn && sig.ack {
        // We joined right at the SYN-ACK; treat as handshake in progress.
        TcpState::SynAckSeen
    } else {
        // Data/ACK without a handshake: we started capturing mid-connection.
        TcpState::JoinedMidStream
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(syn: bool, ack: bool, fin: bool, rst: bool) -> TcpSignals {
        TcpSignals {
            syn,
            ack,
            fin,
            rst,
            seq: 0,
            payload_len: 0,
            window: 0,
        }
    }

    #[test]
    fn full_handshake_reaches_established() {
        let s = initial_tcp(&sig(true, false, false, false));
        assert_eq!(s, TcpState::SynSeen);
        let s = advance_tcp(s, &sig(true, true, false, false), false);
        assert_eq!(s, TcpState::SynAckSeen);
        let s = advance_tcp(s, &sig(false, true, false, false), true);
        assert_eq!(s, TcpState::Established);
        assert_eq!(s.to_flow_state(), FlowState::Established);
    }

    #[test]
    fn reset_from_any_state_is_terminal() {
        let s = advance_tcp(TcpState::Established, &sig(false, false, false, true), true);
        assert_eq!(s, TcpState::Reset);
        assert!(s.is_terminal());
    }

    #[test]
    fn graceful_teardown() {
        let s = advance_tcp(TcpState::Established, &sig(false, false, true, false), true);
        assert_eq!(s, TcpState::FinWait);
        let s = advance_tcp(s, &sig(false, true, true, false), false);
        assert_eq!(s, TcpState::Closing);
        let s = advance_tcp(s, &sig(false, true, false, false), true);
        assert_eq!(s, TcpState::Closed);
        assert!(s.is_terminal());
    }

    #[test]
    fn mid_stream_start_is_flagged_not_wrong() {
        let s = initial_tcp(&sig(false, true, false, false));
        assert_eq!(s, TcpState::JoinedMidStream);
        assert_eq!(s.to_flow_state(), FlowState::Established);
    }
}
