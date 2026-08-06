//! Structured dissection output. Dissection is **stateless per
//! packet**: each parse depends only on the bytes and lower-layer
//! context, never on history — that is what lets the decode pool parallelize
//! freely. Cross-packet state (flows, reassembly) belongs to docs/06.
//!
//! **Partial success is valid**: if a deeper layer fails, the
//! layers that parsed are retained and [`Decoded::partial`] is set; the packet
//! is never discarded.
//!
//! Two currencies flow out of here: the coarse [`netpulse_core::ProtoEventKind`]
//! landmarks (the storage/narrative currency, stamped with a flow id + timestamp
//! by docs/06) and the richer [`L7Detail`] the flow engine needs for causal
//! session lineage (DNS name→IP, TLS SNI — .

use std::net::IpAddr;

use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
use netpulse_core::ProtoEventKind;

/// The link-layer framing a frame arrived in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Ethernet,
    /// BSD/loopback null header (macOS `lo0`, some pcap captures).
    Loopback,
    /// Link type not modelled; network layer parsing is skipped.
    Unknown,
}

/// The parsed L3 header, protocol-agnostic across IPv4/IPv6.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetworkHeader {
    pub src: IpAddr,
    pub dst: IpAddr,
    pub l4: L4Proto,
    /// TTL (v4) / hop limit (v6).
    pub ttl: u8,
    /// IP version, 4 or 6.
    pub version: u8,
}

/// TCP control bits. Feed the flow state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TcpFlags {
    pub syn: bool,
    pub ack: bool,
    pub fin: bool,
    pub rst: bool,
    pub psh: bool,
    pub urg: bool,
}

/// Parsed TCP header fields relevant to reconstruction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TcpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub seq: u32,
    pub ack: u32,
    pub flags: TcpFlags,
    pub window: u16,
    /// Bytes of application data after the TCP header.
    pub payload_len: u32,
}

/// Parsed UDP header fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UdpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    /// Bytes of application data after the UDP header.
    pub payload_len: u32,
}

/// The transport layer, or an unmodelled IP protocol number kept verbatim for
/// honest reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Tcp(TcpHeader),
    Udp(UdpHeader),
    Other(u8),
}

impl Transport {
    fn ports(&self) -> Option<(u16, u16)> {
        match self {
            Transport::Tcp(t) => Some((t.src_port, t.dst_port)),
            Transport::Udp(u) => Some((u.src_port, u.dst_port)),
            Transport::Other(_) => None,
        }
    }
}

/// One DNS question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsQuestion {
    pub name: String,
    pub qtype: u16,
}

/// One DNS answer record — the raw material for DNS→connection lineage
///Only the record kinds that carry causal weight are modelled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsAnswer {
    pub name: String,
    /// Resolved address for A/AAAA answers.
    pub addr: Option<IpAddr>,
    /// Target name for CNAME answers.
    pub cname: Option<String>,
    pub ttl: u32,
}

/// Extracted DNS fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsInfo {
    pub is_response: bool,
    pub rcode: u8,
    pub questions: Vec<DnsQuestion>,
    pub answers: Vec<DnsAnswer>,
}

/// Extracted TLS handshake fields, all read in the clear. No
/// decryption is ever performed.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TlsInfo {
    pub is_client_hello: bool,
    pub is_server_hello: bool,
    /// Server Name Indication, visible unless ECH is used.
    pub sni: Option<String>,
    /// Negotiated application protocols from ALPN.
    pub alpn: Vec<String>,
}

/// Extracted plaintext HTTP/1.1 fields. Most HTTP rides inside
/// TLS; this only fires on cleartext.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HttpInfo {
    pub is_request: bool,
    pub method: Option<String>,
    pub host: Option<String>,
    pub path: Option<String>,
    pub status: Option<u16>,
}

/// Richer L7 detail for the flow engine's causal reasoning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum L7Detail {
    Dns(DnsInfo),
    Tls(TlsInfo),
    Http(HttpInfo),
}

/// The full result of dissecting one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Decoded {
    pub link: LinkKind,
    pub network: Option<NetworkHeader>,
    pub transport: Option<Transport>,
    pub l7: L7Proto,
    pub l7_detail: Option<L7Detail>,
    /// Coarse protocol landmarks; the flow engine stamps each with a flow id and
    /// capture timestamp to form a [`netpulse_core::ProtoEvent`].
    pub events: Vec<ProtoEventKind>,
    /// True when a deeper layer failed to parse but shallower layers succeeded
    ///
    pub partial: bool,
}

impl Decoded {
    pub(crate) fn empty(link: LinkKind) -> Self {
        Self {
            link,
            network: None,
            transport: None,
            l7: L7Proto::Unknown,
            l7_detail: None,
            events: Vec::new(),
            partial: false,
        }
    }

    /// The canonical conversation key, when both L3 and transport ports parsed.
    /// Returns `None` for protocols without ports (e.g. ICMP).
    pub fn five_tuple(&self) -> Option<FiveTuple> {
        let net = self.network?;
        let (sp, dp) = self.transport.as_ref()?.ports()?;
        Some(FiveTuple::new(net.src, sp, net.dst, dp, net.l4))
    }

    /// Application payload length carried by the transport layer.
    pub fn payload_len(&self) -> u32 {
        match &self.transport {
            Some(Transport::Tcp(t)) => t.payload_len,
            Some(Transport::Udp(u)) => u.payload_len,
            _ => 0,
        }
    }

    /// The parsed TCP header, if this packet was TCP.
    pub fn tcp(&self) -> Option<&TcpHeader> {
        match &self.transport {
            Some(Transport::Tcp(t)) => Some(t),
            _ => None,
        }
    }
}
