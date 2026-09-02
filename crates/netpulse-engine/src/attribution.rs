//! Attribution — mapping each flow to the OS process that caused it.
//!
//! A captured packet carries a 5-tuple but no PID; the OS knows the mapping, but
//! it lives in per-OS tables that change over time and can miss short-lived
//! flows. So attribution is a **time-sensitive correlation** between
//! the flow stream and periodic socket-table snapshots — not a lookup
//!
//!
//! This module is the platform-neutral correlator: **poll + cache + match**
//! with a time-indexed history, retro-matching,
//! PID-reuse safety via process start-time, and graded confidence
//!The per-OS [`SocketTableSource`] backends stay behind the
//! trait in `netpulse-platform`; everything here is exercised
//! against a synthetic source, so the hard correlation logic is fully tested
//! without any OS calls or privilege.
//!
//! The governing stance: **attribute confidently when the OS gives
//! clear ownership; say "unknown" honestly when it doesn't.** A wrong PID is
//! worse than an admitted unknown, so every ambiguous case degrades to
//! [`AttributionConfidence::Unknown`], never a guess.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use netpulse_core::net::{FiveTuple, L4Proto};
use netpulse_core::{AttributionConfidence, SocketOwner};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum CandidateRank {
    WildcardUdp = 1,
    SpecificUdp = 2,
    ReversedExact = 3,
    DirectExact = 4,
}

/// How long a cached socket→PID mapping stays valid after the snapshot that
/// observed it (: the table snapshot may arrive slightly after a
/// flow's first packet, so mappings must have a validity window). Nanoseconds.
pub const MAPPING_VALIDITY_NANOS: u64 = 2_000_000_000; // 2s

/// How far *before* a snapshot a flow may have started and still be retro-matched
/// to it: a connection that opened just before the poll is back-
/// filled when the snapshot arrives. Nanoseconds.
pub const RETRO_MATCH_NANOS: u64 = 1_000_000_000; // 1s

/// One cached mapping: who owned a 5-tuple, and the window in which that
/// ownership is considered valid.
#[derive(Debug, Clone)]
struct CachedMapping {
    pid: u64,
    start_mono_nanos: u64,
    /// Snapshot time this mapping was observed at.
    observed_at: u64,
}

/// The outcome of attributing one flow: the resolved PID (when
/// known) with a graded confidence and the process's start time for PID-reuse
/// safety. `Unknown` confidence means honestly unattributed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Attribution {
    pub pid: Option<u64>,
    pub start_mono_nanos: u64,
    pub confidence: AttributionConfidence,
}

impl Attribution {
    /// The honest "unknown owner" result.
    pub fn unknown() -> Self {
        Self {
            pid: None,
            start_mono_nanos: 0,
            confidence: AttributionConfidence::Unknown,
        }
    }
}

/// The time-indexed correlator. Feed it socket-table snapshots as
/// they are polled; ask it to attribute a flow by its 5-tuple and start time. It
/// keeps a bounded history of recent mappings keyed by 5-tuple so per-flow
/// matching is a cheap lookup rather than a table re-scan.
#[derive(Debug, Default)]
pub struct Correlator {
    /// Most recent valid mappings per 5-tuple. A tuple can be reused over time;
    /// we keep the newest observation and its predecessor's start time is
    /// distinguished by `start_mono_nanos`.
    cache: HashMap<FiveTuple, CachedMapping>,
    /// Snapshots retained for retro-matching flows that started just before a
    /// poll. Bounded to the most recent snapshot per tuple.
    latest_snapshot_at: u64,
}

impl Correlator {
    /// Create an empty correlator.
    pub fn new() -> Self {
        Self::default()
    }

    /// Ingest a socket-table snapshot observed at monotonic time `at`. Newer observations supersede older ones for the same
    /// 5-tuple; a changed `start_mono_nanos` means the socket was recycled by a
    /// new process, and the fresh identity wins.
    pub fn ingest_snapshot(&mut self, at: u64, owners: &[SocketOwner]) {
        self.latest_snapshot_at = self.latest_snapshot_at.max(at);
        for o in owners {
            self.cache.insert(
                o.tuple,
                CachedMapping {
                    pid: o.pid,
                    start_mono_nanos: o.start_mono_nanos,
                    observed_at: at,
                },
            );
        }
    }

    /// Attribute a flow that started at `flow_start` to a process (
    /// match step). Returns a graded [`Attribution`]:
    ///
    /// - **High** when a cached mapping's validity window contains the flow start
    ///   (a direct match).
    /// - **Low** when only a retro-match applies — the flow started shortly
    ///   before the snapshot that first saw the socket.
    /// - **Unknown** when no mapping fits, e.g. a flow too brief to ever appear
    ///   in a snapshot. Never a guessed PID.
    pub fn attribute(&self, tuple: &FiveTuple, flow_start: u64) -> Attribution {
        // 1. Generate Candidate Socket Keys preserving address family
        struct Candidate {
            tuple: FiveTuple,
            rank: CandidateRank,
        }

        let mut candidates = Vec::with_capacity(6);

        // Direct Exact Match
        candidates.push(Candidate {
            tuple: *tuple,
            rank: CandidateRank::DirectExact,
        });

        // Reversed Exact Match
        candidates.push(Candidate {
            tuple: FiveTuple::new(
                tuple.dst_ip,
                tuple.dst_port,
                tuple.src_ip,
                tuple.src_port,
                tuple.l4,
            ),
            rank: CandidateRank::ReversedExact,
        });

        // UDP Local & Wildcard Listeners (preserves address family strictly)
        if tuple.l4 == L4Proto::Udp {
            // Source Endpoint Candidates:
            candidates.push(Candidate {
                tuple: FiveTuple::new(tuple.src_ip, tuple.src_port, tuple.src_ip, 0, L4Proto::Udp),
                rank: CandidateRank::SpecificUdp,
            });
            let wildcard_src = match tuple.src_ip {
                IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::UNSPECIFIED),
            };
            candidates.push(Candidate {
                tuple: FiveTuple::new(wildcard_src, tuple.src_port, wildcard_src, 0, L4Proto::Udp),
                rank: CandidateRank::WildcardUdp,
            });

            // Destination Endpoint Candidates:
            candidates.push(Candidate {
                tuple: FiveTuple::new(tuple.dst_ip, tuple.dst_port, tuple.dst_ip, 0, L4Proto::Udp),
                rank: CandidateRank::SpecificUdp,
            });
            let wildcard_dst = match tuple.dst_ip {
                IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::UNSPECIFIED),
            };
            candidates.push(Candidate {
                tuple: FiveTuple::new(wildcard_dst, tuple.dst_port, wildcard_dst, 0, L4Proto::Udp),
                rank: CandidateRank::WildcardUdp,
            });
        }

        // 2. Temporal Validity Filtering
        struct ValidMatch {
            rank: CandidateRank,
            pid: u64,
            start_mono_nanos: u64,
            confidence: AttributionConfidence,
        }

        let mut valid_matches = Vec::new();
        for cand in candidates {
            let Some(m) = self.cache.get(&cand.tuple) else {
                continue;
            };

            let valid_from = m.observed_at.saturating_sub(RETRO_MATCH_NANOS);
            let valid_to = m.observed_at + MAPPING_VALIDITY_NANOS;

            if flow_start >= valid_from && flow_start < valid_to {
                let is_direct_window = flow_start >= m.observed_at;
                let confidence = match cand.rank {
                    CandidateRank::DirectExact
                    | CandidateRank::ReversedExact
                    | CandidateRank::SpecificUdp => {
                        if is_direct_window {
                            AttributionConfidence::High
                        } else {
                            AttributionConfidence::Low
                        }
                    }
                    CandidateRank::WildcardUdp => AttributionConfidence::Low,
                };

                valid_matches.push(ValidMatch {
                    rank: cand.rank,
                    pid: m.pid,
                    start_mono_nanos: m.start_mono_nanos,
                    confidence,
                });
            }
        }

        if valid_matches.is_empty() {
            return Attribution::unknown();
        }

        // 3. Rank Valid Candidates by Specificity (DirectExact > ReversedExact > SpecificUdp > WildcardUdp)
        let max_rank = valid_matches.iter().map(|m| m.rank).max().unwrap();
        let top_candidates: Vec<&ValidMatch> = valid_matches
            .iter()
            .filter(|m| m.rank == max_rank)
            .collect();

        // 4. Ambiguity Guard: Evaluated strictly among candidates at the same highest specificity rank
        let first = top_candidates[0];
        let all_agree = top_candidates
            .iter()
            .all(|c| c.pid == first.pid && c.start_mono_nanos == first.start_mono_nanos);

        if !all_agree {
            return Attribution::unknown();
        }

        Attribution {
            pid: Some(first.pid),
            start_mono_nanos: first.start_mono_nanos,
            confidence: first.confidence,
        }
    }

    /// Whether a cached mapping for `tuple` describes the *same* process instance
    /// as `start_mono_nanos` — the PID-reuse guard. A matching PID
    /// with a different start time is a recycled PID, not the original process.
    pub fn is_same_process(&self, tuple: &FiveTuple, pid: u64, start_mono_nanos: u64) -> bool {
        self.cache
            .get(tuple)
            .is_some_and(|m| m.pid == pid && m.start_mono_nanos == start_mono_nanos)
    }

    /// Drop mappings whose validity window ended before `now`, bounding memory
    ///Returns the number pruned.
    pub fn evict_expired(&mut self, now: u64) -> usize {
        let before = self.cache.len();
        self.cache
            .retain(|_, m| m.observed_at + MAPPING_VALIDITY_NANOS > now);
        before - self.cache.len()
    }

    /// Number of cached mappings (for tests and health reporting).
    pub fn cached(&self) -> usize {
        self.cache.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::L4Proto;
    use netpulse_core::traits::SocketTableSource;
    use netpulse_core::{Process, Result};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    fn tuple(port: u16) -> FiveTuple {
        let c = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 10));
        let s = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));
        FiveTuple::new(c, port, s, 443, L4Proto::Tcp)
    }

    fn owner(port: u16, pid: u64, start: u64) -> SocketOwner {
        SocketOwner {
            tuple: tuple(port),
            pid,
            start_mono_nanos: start,
        }
    }

    #[test]
    fn direct_match_is_high_confidence() {
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &[owner(50000, 42, 500)]);
        // Flow started right at/after the snapshot → direct, high-confidence.
        let a = c.attribute(&tuple(50000), 1_000);
        assert_eq!(a.pid, Some(42));
        assert_eq!(a.confidence, AttributionConfidence::High);
    }

    #[test]
    fn flow_just_before_snapshot_is_retro_matched_low() {
        let mut c = Correlator::new();
        c.ingest_snapshot(2_000_000_000, &[owner(50001, 7, 100)]);
        // Flow started 0.5s before the snapshot → retro-match, low confidence.
        let a = c.attribute(&tuple(50001), 2_000_000_000 - 500_000_000);
        assert_eq!(a.pid, Some(7));
        assert_eq!(a.confidence, AttributionConfidence::Low);
    }

    #[test]
    fn unseen_tuple_is_honest_unknown() {
        let c = Correlator::new();
        // A flow that never appeared in any snapshot (too brief .
        let a = c.attribute(&tuple(50002), 1_000);
        assert_eq!(a.pid, None);
        assert_eq!(a.confidence, AttributionConfidence::Unknown);
    }

    #[test]
    fn flow_far_after_mapping_expiry_is_unknown_not_wrong() {
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &[owner(50003, 9, 100)]);
        // Flow starts well past the validity window → not attributed to the old
        // socket owner; honest unknown, never a wrong PID.
        let a = c.attribute(&tuple(50003), 1_000 + MAPPING_VALIDITY_NANOS + 1);
        assert_eq!(a.confidence, AttributionConfidence::Unknown);
    }

    #[test]
    fn pid_reuse_is_distinguished_by_start_time() {
        let mut c = Correlator::new();
        // Same PID 100 but a different process start time = a recycled PID.
        c.ingest_snapshot(1_000, &[owner(50004, 100, 500)]);
        assert!(c.is_same_process(&tuple(50004), 100, 500));
        assert!(
            !c.is_same_process(&tuple(50004), 100, 999),
            "a reused PID with a new start time is a different process"
        );
    }

    #[test]
    fn newer_snapshot_supersedes_older_for_same_tuple() {
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &[owner(50005, 1, 100)]);
        c.ingest_snapshot(2_000, &[owner(50005, 2, 900)]); // socket recycled
        let a = c.attribute(&tuple(50005), 2_000);
        assert_eq!(a.pid, Some(2), "the newest owner wins");
    }

    #[test]
    fn eviction_bounds_the_cache() {
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &[owner(50006, 1, 100)]);
        assert_eq!(c.cached(), 1);
        let pruned = c.evict_expired(1_000 + MAPPING_VALIDITY_NANOS + 1);
        assert_eq!(pruned, 1);
        assert_eq!(c.cached(), 0);
    }

    // ---- A synthetic SocketTableSource proves the trait is usable off-OS ----

    #[derive(Debug)]
    struct FakeSource {
        owners: Vec<SocketOwner>,
    }

    impl SocketTableSource for FakeSource {
        fn snapshot(&self) -> Result<Vec<SocketOwner>> {
            Ok(self.owners.clone())
        }
        fn process_info(&self, pid: u64) -> Result<Option<Process>> {
            Ok(Some(Process {
                pid,
                name: format!("proc{pid}"),
                exe_path: format!("/usr/bin/proc{pid}"),
                signer: None,
                start_mono_nanos: 100,
                cpu_percent: None,
                memory_bytes: None,
            }))
        }
    }

    #[test]
    fn correlator_drives_from_a_trait_source() {
        let src = FakeSource {
            owners: vec![owner(50007, 55, 100)],
        };
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &src.snapshot().unwrap());
        let a = c.attribute(&tuple(50007), 1_000);
        assert_eq!(a.pid, Some(55));
        // The source can enrich identity for an attributed PID.
        let info = src.process_info(55).unwrap().unwrap();
        assert_eq!(info.name, "proc55");
    }

    #[test]
    fn attribute_reverse_tcp_flow() {
        let mut c = Correlator::new();
        c.ingest_snapshot(1_000, &[owner(50010, 42, 500)]);
        // Reverse direction: server to client flow
        let rev = FiveTuple::new(
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            443,
            IpAddr::V4(Ipv4Addr::new(192, 168, 0, 10)),
            50010,
            L4Proto::Tcp,
        );
        let a = c.attribute(&rev, 1_000);
        assert_eq!(a.pid, Some(42));
        assert_eq!(a.confidence, AttributionConfidence::High);
    }

    #[test]
    fn attribute_local_bound_udp_socket() {
        let mut c = Correlator::new();
        let local_ip = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 10));
        let udp_listener = FiveTuple::new(local_ip, 5353, local_ip, 0, L4Proto::Udp);
        c.ingest_snapshot(
            1_000,
            &[SocketOwner {
                tuple: udp_listener,
                pid: 77,
                start_mono_nanos: 100,
            }],
        );

        // Outbound UDP packet from local bound port to multicast
        let flow = FiveTuple::new(
            local_ip,
            5353,
            IpAddr::V4(Ipv4Addr::new(224, 0, 0, 251)),
            5353,
            L4Proto::Udp,
        );
        let a = c.attribute(&flow, 1_000);
        assert_eq!(a.pid, Some(77));
        assert_eq!(a.confidence, AttributionConfidence::High);

        // Inbound UDP packet to local bound port
        let inbound = FiveTuple::new(
            IpAddr::V4(Ipv4Addr::new(192, 168, 0, 20)),
            40000,
            local_ip,
            5353,
            L4Proto::Udp,
        );
        let a_in = c.attribute(&inbound, 1_000);
        assert_eq!(a_in.pid, Some(77));
        assert_eq!(a_in.confidence, AttributionConfidence::High);
    }

    #[test]
    fn attribute_wildcard_ipv4_udp_listener() {
        let mut c = Correlator::new();
        let wildcard = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
        let udp_listener = FiveTuple::new(wildcard, 8080, wildcard, 0, L4Proto::Udp);
        c.ingest_snapshot(
            1_000,
            &[SocketOwner {
                tuple: udp_listener,
                pid: 88,
                start_mono_nanos: 100,
            }],
        );

        let flow = FiveTuple::new(
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5)),
            8080,
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            53,
            L4Proto::Udp,
        );
        let a = c.attribute(&flow, 1_000);
        assert_eq!(a.pid, Some(88));
        assert_eq!(a.confidence, AttributionConfidence::Low);
    }

    #[test]
    fn attribute_wildcard_ipv6_udp_listener() {
        let mut c = Correlator::new();
        let wildcard = IpAddr::V6(Ipv6Addr::UNSPECIFIED);
        let udp_listener = FiveTuple::new(wildcard, 9090, wildcard, 0, L4Proto::Udp);
        c.ingest_snapshot(
            1_000,
            &[SocketOwner {
                tuple: udp_listener,
                pid: 99,
                start_mono_nanos: 100,
            }],
        );

        let client_ip = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1));
        let server_ip = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 2));
        let flow = FiveTuple::new(client_ip, 9090, server_ip, 53, L4Proto::Udp);
        let a = c.attribute(&flow, 1_000);
        assert_eq!(a.pid, Some(99));
        assert_eq!(a.confidence, AttributionConfidence::Low);
    }

    #[test]
    fn specific_listener_takes_precedence_over_wildcard() {
        let mut c = Correlator::new();
        let specific_ip = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 10));
        let specific = FiveTuple::new(specific_ip, 53, specific_ip, 0, L4Proto::Udp);
        let wildcard_ip = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
        let wildcard = FiveTuple::new(wildcard_ip, 53, wildcard_ip, 0, L4Proto::Udp);

        c.ingest_snapshot(
            1_000,
            &[
                SocketOwner {
                    tuple: specific,
                    pid: 100,
                    start_mono_nanos: 100,
                },
                SocketOwner {
                    tuple: wildcard,
                    pid: 200,
                    start_mono_nanos: 100,
                },
            ],
        );

        let flow = FiveTuple::new(
            specific_ip,
            53,
            IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            53,
            L4Proto::Udp,
        );
        let a = c.attribute(&flow, 1_000);
        assert_eq!(
            a.pid,
            Some(100),
            "Specific listener PID 100 must outrank wildcard listener PID 200"
        );
    }

    #[test]
    fn competing_ambiguous_listeners_return_unknown() {
        let mut c = Correlator::new();
        let ip1 = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 10));
        let ip2 = IpAddr::V4(Ipv4Addr::new(192, 168, 0, 20));
        // Both src and dst match specific UDP listeners of differing PIDs
        let listener_src = FiveTuple::new(ip1, 6000, ip1, 0, L4Proto::Udp);
        let listener_dst = FiveTuple::new(ip2, 7000, ip2, 0, L4Proto::Udp);

        c.ingest_snapshot(
            1_000,
            &[
                SocketOwner {
                    tuple: listener_src,
                    pid: 111,
                    start_mono_nanos: 100,
                },
                SocketOwner {
                    tuple: listener_dst,
                    pid: 222,
                    start_mono_nanos: 100,
                },
            ],
        );

        // Flow connecting ip1:6000 to ip2:7000 - both are equally specific UDP listeners with differing PIDs
        let flow = FiveTuple::new(ip1, 6000, ip2, 7000, L4Proto::Udp);
        let a = c.attribute(&flow, 1_000);
        assert_eq!(
            a.pid, None,
            "Equally ranked competing listeners with differing PIDs must return unknown"
        );
        assert_eq!(a.confidence, AttributionConfidence::Unknown);
    }

    #[test]
    fn unobserved_udp_returns_unknown() {
        let c = Correlator::new();
        let flow = FiveTuple::new(
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            12345,
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)),
            53,
            L4Proto::Udp,
        );
        let a = c.attribute(&flow, 1_000);
        assert_eq!(a.pid, None);
        assert_eq!(a.confidence, AttributionConfidence::Unknown);
    }

    #[test]
    fn address_family_mismatch_never_resolves() {
        let mut c = Correlator::new();
        let ipv4_wildcard = FiveTuple::new(
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            53,
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            0,
            L4Proto::Udp,
        );
        c.ingest_snapshot(
            1_000,
            &[SocketOwner {
                tuple: ipv4_wildcard,
                pid: 333,
                start_mono_nanos: 100,
            }],
        );

        // IPv6 flow on port 53 must NOT match the IPv4 wildcard
        let ipv6_flow = FiveTuple::new(
            IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1)),
            53,
            IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 2)),
            53,
            L4Proto::Udp,
        );
        let a = c.attribute(&ipv6_flow, 1_000);
        assert_eq!(
            a.pid, None,
            "IPv6 traffic must not resolve against IPv4 socket keys"
        );
    }
}
