//! The layered decode pipeline (docs/07 §4.2) and protocol identification
//! (docs/07 §5). This ties the per-layer parsers together: link → network →
//! transport → application, selecting the next dissector from the identification
//! signal of the layer below. Ports are only a hint; payload heuristics confirm
//! or override them (docs/07 §5), and identification stays honest — an
//! unrecognized payload leaves [`L7Proto::Unknown`] rather than guessing.

use netpulse_core::net::{L4Proto, L7Proto};
use netpulse_core::ProtoEventKind;

use crate::frame::{Decoded, L7Detail, LinkKind, Transport};
use crate::reader::Reader;
use crate::{dns, http, layers, tls};

/// Which link layer a capture's frames use, from the pcap link type
/// (docs/05 §5). Chosen once per capture source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkType {
    Ethernet,
    /// BSD loopback / null (`DLT_NULL`).
    Loopback,
    /// Raw IP with no link header (`DLT_RAW`).
    RawIp,
}

/// Decode one frame end-to-end. Never fails at the top level: a deeper-layer
/// error yields a [`Decoded`] with `partial = true` holding whatever parsed
/// (docs/07 §3.5). The frame is never discarded.
pub fn decode_frame(link: LinkType, bytes: &[u8]) -> Decoded {
    let (link_kind, l3) = match link {
        LinkType::Ethernet => {
            let mut r = Reader::new(bytes);
            match layers::ethernet(&mut r) {
                Ok((kind, rest)) => (LinkKind::Ethernet, resolve_ip(kind, rest)),
                Err(_) => return partial(LinkKind::Ethernet),
            }
        }
        LinkType::Loopback => {
            let mut r = Reader::new(bytes);
            match layers::loopback(&mut r) {
                Ok((kind, rest)) => (LinkKind::Loopback, resolve_ip(kind, rest)),
                Err(_) => return partial(LinkKind::Loopback),
            }
        }
        LinkType::RawIp => (LinkKind::Unknown, Some(IpBytes::Guess(bytes))),
    };

    let mut out = Decoded::empty(link_kind);
    let ip = match l3 {
        Some(ip) => ip,
        None => return out, // non-IP frame; link layer only
    };

    // Network layer.
    let (net, _proto, l4payload) = match parse_ip(ip) {
        Ok(v) => v,
        Err(_) => {
            out.partial = true;
            return out;
        }
    };
    out.network = Some(net);

    // Transport layer.
    match net.l4 {
        L4Proto::Tcp => {
            let mut r = Reader::new(l4payload);
            match layers::tcp(&mut r) {
                Ok((hdr, app)) => {
                    out.transport = Some(Transport::Tcp(hdr));
                    identify_and_dissect(&mut out, hdr.src_port, hdr.dst_port, app, true);
                }
                Err(_) => out.partial = true,
            }
        }
        L4Proto::Udp => {
            let mut r = Reader::new(l4payload);
            match layers::udp(&mut r) {
                Ok((hdr, app)) => {
                    out.transport = Some(Transport::Udp(hdr));
                    identify_and_dissect(&mut out, hdr.src_port, hdr.dst_port, app, false);
                }
                Err(_) => out.partial = true,
            }
        }
        L4Proto::Other(n) => {
            out.transport = Some(Transport::Other(n));
        }
        // L4Proto is #[non_exhaustive] (docs/02 §6): a future transport falls
        // through as an unmodelled protocol rather than breaking the build.
        _ => {}
    }

    out
}

/// Intermediate: bytes destined for IP parsing, tagged by whether the version is
/// already known from the link layer or must be sniffed from the first nibble.
enum IpBytes<'a> {
    V4(&'a [u8]),
    V6(&'a [u8]),
    Guess(&'a [u8]),
}

fn resolve_ip(kind: layers::EtherPayload, rest: &[u8]) -> Option<IpBytes<'_>> {
    match kind {
        layers::EtherPayload::Ipv4 => Some(IpBytes::V4(rest)),
        layers::EtherPayload::Ipv6 => Some(IpBytes::V6(rest)),
        layers::EtherPayload::Other(_) => None,
    }
}

fn parse_ip(ip: IpBytes<'_>) -> netpulse_core::Result<(crate::frame::NetworkHeader, u8, &[u8])> {
    match ip {
        IpBytes::V4(b) => {
            let mut r = Reader::new(b);
            layers::ipv4(&mut r)
        }
        IpBytes::V6(b) => {
            let mut r = Reader::new(b);
            layers::ipv6(&mut r)
        }
        IpBytes::Guess(b) => {
            let version = b.first().map(|v| v >> 4).unwrap_or(0);
            let mut r = Reader::new(b);
            match version {
                6 => layers::ipv6(&mut r),
                _ => layers::ipv4(&mut r),
            }
        }
    }
}

/// Identify the L7 protocol (docs/07 §5) and run the matching dissector,
/// populating `out.l7`, `out.l7_detail`, and coarse events. `is_tcp` picks the
/// stream vs datagram candidate set.
fn identify_and_dissect(out: &mut Decoded, src_port: u16, dst_port: u16, app: &[u8], is_tcp: bool) {
    if app.is_empty() {
        // Control-only segment (e.g. bare SYN/ACK): protocol still hinted by port.
        out.l7 = port_hint(src_port, dst_port, is_tcp);
        return;
    }

    if is_tcp {
        // TLS: structural signature (handshake record) is authoritative.
        if let Ok(Some(info)) = tls::dissect(app) {
            out.l7 = L7Proto::Tls;
            if info.is_client_hello {
                out.events.push(ProtoEventKind::TlsClientHello);
            }
            if info.is_server_hello {
                out.events.push(ProtoEventKind::TlsServerHello);
            }
            out.l7_detail = Some(L7Detail::Tls(info));
            return;
        }
        // HTTP: request/status line signature.
        if let Some(info) = http::dissect(app) {
            out.l7 = L7Proto::Http1;
            out.events.push(if info.is_request {
                ProtoEventKind::HttpRequest
            } else {
                ProtoEventKind::HttpResponse
            });
            out.l7_detail = Some(L7Detail::Http(info));
            return;
        }
    } else {
        // UDP: DNS by structure, refined by the port hint.
        if src_port == 53 || dst_port == 53 {
            if let Ok(Some(info)) = dns::dissect(app) {
                out.l7 = L7Proto::Dns;
                out.events.push(if info.is_response {
                    ProtoEventKind::DnsResponse
                } else {
                    ProtoEventKind::DnsQuery
                });
                out.l7_detail = Some(L7Detail::Dns(info));
                return;
            }
        }
        // QUIC identification (long-header form) is left to Phase 1 deepening
        // (docs/07 §6.9); for now UDP/443 is hinted, not dissected.
    }

    out.l7 = port_hint(src_port, dst_port, is_tcp);
}

/// A best-effort L7 guess from port numbers alone — used only when payload
/// heuristics did not fire. Never upgraded to a confident classification.
fn port_hint(src: u16, dst: u16, is_tcp: bool) -> L7Proto {
    let p = |want: u16| src == want || dst == want;
    if is_tcp {
        if p(443) {
            L7Proto::Tls
        } else if p(80) {
            L7Proto::Http1
        } else {
            L7Proto::Unknown
        }
    } else if p(53) {
        L7Proto::Dns
    } else {
        L7Proto::Unknown
    }
}

fn partial(link: LinkKind) -> Decoded {
    let mut d = Decoded::empty(link);
    d.partial = true;
    d
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    /// Build eth+ipv4+udp+dns for a query, to exercise the whole pipeline.
    fn eth_ipv4_udp_dns() -> Vec<u8> {
        let mut dns_msg = vec![0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
        for label in ["example", "com"] {
            dns_msg.push(label.len() as u8);
            dns_msg.extend_from_slice(label.as_bytes());
        }
        dns_msg.push(0);
        dns_msg.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]);

        let mut udp = Vec::new();
        udp.extend_from_slice(&50000u16.to_be_bytes());
        udp.extend_from_slice(&53u16.to_be_bytes());
        udp.extend_from_slice(&((dns_msg.len() + 8) as u16).to_be_bytes());
        udp.extend_from_slice(&[0, 0]); // checksum
        udp.extend_from_slice(&dns_msg);

        let mut ip = vec![0x45, 0x00];
        ip.extend_from_slice(&((20 + udp.len()) as u16).to_be_bytes());
        ip.extend_from_slice(&[0x00, 0x00, 0x40, 0x00, 0x40, 17, 0x00, 0x00]);
        ip.extend_from_slice(&[192, 168, 0, 1]);
        ip.extend_from_slice(&[8, 8, 8, 8]);
        ip.extend_from_slice(&udp);

        let mut frame = vec![
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // MACs
            0x08, 0x00,
        ];
        frame.extend_from_slice(&ip);
        frame
    }

    #[test]
    fn full_pipeline_identifies_dns() {
        let frame = eth_ipv4_udp_dns();
        let d = decode_frame(LinkType::Ethernet, &frame);
        assert_eq!(d.l7, L7Proto::Dns);
        assert!(!d.partial);
        assert_eq!(d.events, vec![ProtoEventKind::DnsQuery]);
        let ft = d.five_tuple().unwrap();
        assert_eq!(ft.src_ip, IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)));
        assert_eq!(ft.dst_port, 53);
        assert_eq!(ft.l4, L4Proto::Udp);
    }

    #[test]
    fn garbage_frame_is_partial_never_panics() {
        let d = decode_frame(LinkType::Ethernet, &[0xff; 3]);
        assert!(d.partial);
        assert_eq!(d.l7, L7Proto::Unknown);
    }

    #[test]
    fn empty_input_is_handled() {
        let d = decode_frame(LinkType::Ethernet, &[]);
        assert!(d.partial);
    }
}
