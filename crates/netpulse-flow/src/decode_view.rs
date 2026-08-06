//! The flow engine's input view (: "consumes dissected packets from
//! `07`"). Rather than couple the flow table to every field of
//! [`netpulse_decode::Decoded`], the engine ingests a compact [`PacketView`]:
//! the canonical key material, direction signals, and the L7 lineage hints that
//! session reconstruction needs.
//!
//! Building the view is where `07` ("what a packet means") meets `06` ("how
//! packets relate over time" — the clean boundary from.

use std::net::IpAddr;

use netpulse_core::net::{FiveTuple, L7Proto};
use netpulse_core::{ProtoEventKind, Timestamp};
use netpulse_decode::{Decoded, L7Detail, Transport};

/// The TCP control/measurement signals the state machine and metrics consume.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TcpSignals {
    pub syn: bool,
    pub ack: bool,
    pub fin: bool,
    pub rst: bool,
    pub seq: u32,
    pub payload_len: u32,
    pub window: u16,
}

/// A DNS name→address resolution extracted from a response, the strongest causal
/// link for session grouping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsResolution {
    pub name: String,
    pub addr: IpAddr,
}

/// One decoded packet, reduced to what the flow engine needs.
#[derive(Debug, Clone, PartialEq)]
pub struct PacketView {
    pub ts: Timestamp,
    pub tuple: FiveTuple,
    pub l7: L7Proto,
    pub payload_len: u32,
    pub tcp: Option<TcpSignals>,
    /// Coarse protocol landmarks to record as `ProtoEvent`s.
    pub events: Vec<ProtoEventKind>,
    /// Name→IP resolutions from a DNS response (for lineage).
    pub dns_resolutions: Vec<DnsResolution>,
    /// TLS SNI, when this packet carried a ClientHello (for lineage).
    pub sni: Option<String>,
}

impl PacketView {
    /// Build a view from decoder output at a capture timestamp. Returns `None`
    /// when the packet has no 5-tuple (e.g. ICMP, non-IP) and so cannot belong
    /// to a flow.
    pub fn from_decoded(ts: Timestamp, d: &Decoded) -> Option<Self> {
        let tuple = d.five_tuple()?;
        let tcp = match &d.transport {
            Some(Transport::Tcp(t)) => Some(TcpSignals {
                syn: t.flags.syn,
                ack: t.flags.ack,
                fin: t.flags.fin,
                rst: t.flags.rst,
                seq: t.seq,
                payload_len: t.payload_len,
                window: t.window,
            }),
            _ => None,
        };

        let mut dns_resolutions = Vec::new();
        let mut sni = None;
        match &d.l7_detail {
            Some(L7Detail::Dns(info)) if info.is_response => {
                for ans in &info.answers {
                    if let Some(addr) = ans.addr {
                        dns_resolutions.push(DnsResolution {
                            name: ans.name.clone(),
                            addr,
                        });
                    }
                }
            }
            Some(L7Detail::Tls(info)) => {
                sni = info.sni.clone();
            }
            _ => {}
        }

        Some(Self {
            ts,
            tuple,
            l7: d.l7,
            payload_len: d.payload_len(),
            tcp,
            events: d.events.clone(),
            dns_resolutions,
            sni,
        })
    }
}
