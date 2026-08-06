//! Link, network, and transport dissectors. Each parses one
//! layer from a byte slice and hands the remaining payload to the next, chosen
//! by the identification signal of the layer below. Every read
//! goes through [`Reader`], so truncated or hostile input yields a clean partial
//! parse, never an over-read.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use netpulse_core::net::L4Proto;
use netpulse_core::Result;

use crate::frame::{NetworkHeader, TcpFlags, TcpHeader, UdpHeader};
use crate::reader::Reader;

const ETHERTYPE_IPV4: u16 = 0x0800;
const ETHERTYPE_IPV6: u16 = 0x86DD;
const ETHERTYPE_VLAN: u16 = 0x8100;
const ETHERTYPE_QINQ: u16 = 0x88A8;

const IPPROTO_TCP: u8 = 6;
const IPPROTO_UDP: u8 = 17;
const IPPROTO_HOPOPTS: u8 = 0;
const IPPROTO_ROUTING: u8 = 43;
const IPPROTO_FRAGMENT: u8 = 44;
const IPPROTO_DSTOPTS: u8 = 60;

/// The EtherType selecting the network layer, after stripping any VLAN tags.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EtherPayload {
    Ipv4,
    Ipv6,
    Other(u16),
}

/// Parse an Ethernet II frame, transparently stripping 802.1Q / 802.1ad VLAN
/// tags. Returns the
/// selected network protocol and the remaining payload.
pub fn ethernet<'a>(r: &mut Reader<'a>) -> Result<(EtherPayload, &'a [u8])> {
    let _dst = r.take(6)?;
    let _src = r.take(6)?;
    let mut ethertype = r.u16()?;
    // Strip up to two stacked VLAN tags (QinQ); each is 4 bytes: TPID already
    // consumed as `ethertype`, then TCI(2) + inner EtherType(2).
    for _ in 0..2 {
        if ethertype == ETHERTYPE_VLAN || ethertype == ETHERTYPE_QINQ {
            let _tci = r.u16()?;
            ethertype = r.u16()?;
        } else {
            break;
        }
    }
    let kind = match ethertype {
        ETHERTYPE_IPV4 => EtherPayload::Ipv4,
        ETHERTYPE_IPV6 => EtherPayload::Ipv6,
        other => EtherPayload::Other(other),
    };
    Ok((kind, r.rest()))
}

/// Parse a BSD loopback / null header (`DLT_NULL`): a 4-byte host-order address
/// family. The captured host's byte order is unknown from the file alone, so we
/// accept the family in either endianness.
pub fn loopback<'a>(r: &mut Reader<'a>) -> Result<(EtherPayload, &'a [u8])> {
    let raw = r.take(4)?;
    let le = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]);
    let be = u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]);
    let family = if le <= 0xff { le } else { be };
    let kind = match family {
        2 => EtherPayload::Ipv4,
        // AF_INET6 differs per OS: 24 (macOS/BSD-ish), 28 (FreeBSD), 30 (macOS).
        24 | 28 | 30 => EtherPayload::Ipv6,
        other => EtherPayload::Other(other as u16),
    };
    Ok((kind, r.rest()))
}

/// Parse an IPv4 header. Honors IHL for options and clamps the
/// payload to the header's total-length field so trailing padding is excluded.
pub fn ipv4<'a>(r: &mut Reader<'a>) -> Result<(NetworkHeader, u8, &'a [u8])> {
    let start = r.position();
    let ver_ihl = r.u8()?;
    let version = ver_ihl >> 4;
    let ihl_words = (ver_ihl & 0x0f) as usize;
    if version != 4 || ihl_words < 5 {
        return Err(netpulse_core::NpError::Decode(format!(
            "not an IPv4 header: version={version} ihl={ihl_words}"
        )));
    }
    let _dscp_ecn = r.u8()?;
    let total_len = r.u16()? as usize;
    let _ident = r.u16()?;
    let _flags_frag = r.u16()?;
    let ttl = r.u8()?;
    let proto = r.u8()?;
    let _checksum = r.u16()?;
    let src = Ipv4Addr::new(r.u8()?, r.u8()?, r.u8()?, r.u8()?);
    let dst = Ipv4Addr::new(r.u8()?, r.u8()?, r.u8()?, r.u8()?);
    // Skip options to reach the payload (IHL counts 32-bit words).
    let header_len = ihl_words * 4;
    let consumed = r.position() - start;
    r.skip(header_len.saturating_sub(consumed))?;
    // Bound the payload by total_length when it is sane; otherwise take the rest.
    let payload = r.rest();
    let payload = match total_len.checked_sub(header_len) {
        Some(n) if n <= payload.len() => &payload[..n],
        _ => payload,
    };
    let net = NetworkHeader {
        src: IpAddr::V4(src),
        dst: IpAddr::V4(dst),
        l4: l4_from(proto),
        ttl,
        version: 4,
    };
    Ok((net, proto, payload))
}

/// Parse an IPv6 header and walk a bounded chain of extension headers to the
/// upper-layer protocol.
pub fn ipv6<'a>(r: &mut Reader<'a>) -> Result<(NetworkHeader, u8, &'a [u8])> {
    let ver_class = r.u8()?;
    if ver_class >> 4 != 6 {
        return Err(netpulse_core::NpError::Decode("not an IPv6 header".into()));
    }
    r.skip(3)?; // rest of traffic class + flow label
    let payload_len = r.u16()? as usize;
    let mut next_header = r.u8()?;
    let hop_limit = r.u8()?;
    let mut src = [0u8; 16];
    src.copy_from_slice(r.take(16)?);
    let mut dst = [0u8; 16];
    dst.copy_from_slice(r.take(16)?);

    // Follow extension headers (bounded to avoid a crafted infinite chain).
    for _ in 0..8 {
        match next_header {
            IPPROTO_HOPOPTS | IPPROTO_ROUTING | IPPROTO_DSTOPTS => {
                let nh = r.u8()?;
                let hdr_ext_len = r.u8()? as usize; // in 8-octet units, not incl first 8
                next_header = nh;
                r.skip(6 + hdr_ext_len * 8)?;
            }
            IPPROTO_FRAGMENT => {
                let nh = r.u8()?;
                r.skip(7)?; // fixed 8-byte fragment header
                next_header = nh;
            }
            _ => break,
        }
    }

    let payload = r.rest();
    // payload_len covers extension headers too; only trust it as an upper bound.
    let payload = if payload_len > 0 {
        &payload[..payload.len().min(payload_len)]
    } else {
        payload
    };
    let net = NetworkHeader {
        src: IpAddr::V6(Ipv6Addr::from(src)),
        dst: IpAddr::V6(Ipv6Addr::from(dst)),
        l4: l4_from(next_header),
        ttl: hop_limit,
        version: 6,
    };
    Ok((net, next_header, payload))
}

fn l4_from(proto: u8) -> L4Proto {
    match proto {
        IPPROTO_TCP => L4Proto::Tcp,
        IPPROTO_UDP => L4Proto::Udp,
        other => L4Proto::Other(other),
    }
}

/// Parse a TCP header and return it with the application payload.
pub fn tcp<'a>(r: &mut Reader<'a>) -> Result<(TcpHeader, &'a [u8])> {
    let start = r.position();
    let src_port = r.u16()?;
    let dst_port = r.u16()?;
    let seq = r.u32()?;
    let ack = r.u32()?;
    let data_off_flags = r.u16()?;
    let data_offset_words = (data_off_flags >> 12) as usize;
    if data_offset_words < 5 {
        return Err(netpulse_core::NpError::Decode(format!(
            "TCP data offset too small: {data_offset_words}"
        )));
    }
    let bits = data_off_flags & 0x003f;
    let flags = TcpFlags {
        urg: bits & 0x20 != 0,
        ack: bits & 0x10 != 0,
        psh: bits & 0x08 != 0,
        rst: bits & 0x04 != 0,
        syn: bits & 0x02 != 0,
        fin: bits & 0x01 != 0,
    };
    let window = r.u16()?;
    let _checksum = r.u16()?;
    let _urg_ptr = r.u16()?;
    let header_len = data_offset_words * 4;
    let consumed = r.position() - start;
    r.skip(header_len.saturating_sub(consumed))?; // options
    let payload = r.rest();
    let hdr = TcpHeader {
        src_port,
        dst_port,
        seq,
        ack,
        flags,
        window,
        payload_len: payload.len() as u32,
    };
    Ok((hdr, payload))
}

/// Parse a UDP header and return it with the application payload.
pub fn udp<'a>(r: &mut Reader<'a>) -> Result<(UdpHeader, &'a [u8])> {
    let src_port = r.u16()?;
    let dst_port = r.u16()?;
    let length = r.u16()? as usize;
    let _checksum = r.u16()?;
    let payload = r.rest();
    // UDP length includes the 8-byte header; clamp to what's actually present.
    let payload = match length.checked_sub(8) {
        Some(n) if n <= payload.len() => &payload[..n],
        _ => payload,
    };
    let hdr = UdpHeader {
        src_port,
        dst_port,
        payload_len: payload.len() as u32,
    };
    Ok((hdr, payload))
}

/// Detect whether `input` looks like an Ethernet frame carrying IP, used to pick
/// the link layer when a capture's link type is ambiguous.
pub fn looks_like_ethernet(input: &[u8]) -> bool {
    if input.len() < 14 {
        return false;
    }
    let et = u16::from_be_bytes([input[12], input[13]]);
    matches!(
        et,
        ETHERTYPE_IPV4 | ETHERTYPE_IPV6 | ETHERTYPE_VLAN | ETHERTYPE_QINQ
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ethernet_ipv4_tcp() {
        // dst, src MACs, ethertype 0x0800
        let mut frame = vec![
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, // dst
            0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, // src
            0x08, 0x00, // IPv4
        ];
        // IPv4 header, 20 bytes, proto=6 (TCP), total_len=40
        frame.extend_from_slice(&[
            0x45, 0x00, 0x00, 0x28, 0x00, 0x00, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 192, 168, 0, 1,
            93, 184, 216, 34,
        ]);
        // TCP header 20 bytes: ports 50000 -> 443, SYN
        frame.extend_from_slice(&[
            0xC3, 0x50, 0x01, 0xBB, 0, 0, 0, 1, 0, 0, 0, 0, 0x50, 0x02, 0xFF, 0xFF, 0, 0, 0, 0,
        ]);

        let mut r = Reader::new(&frame);
        let (kind, l3) = ethernet(&mut r).unwrap();
        assert_eq!(kind, EtherPayload::Ipv4);
        let mut r3 = Reader::new(l3);
        let (net, proto, l4) = ipv4(&mut r3).unwrap();
        assert_eq!(proto, IPPROTO_TCP);
        assert_eq!(net.l4, L4Proto::Tcp);
        assert_eq!(net.ttl, 0x40);
        let mut r4 = Reader::new(l4);
        let (t, _payload) = tcp(&mut r4).unwrap();
        assert_eq!(t.src_port, 50000);
        assert_eq!(t.dst_port, 443);
        assert!(t.flags.syn && !t.flags.ack);
    }

    #[test]
    fn vlan_tag_is_stripped() {
        let mut frame = vec![
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // MACs
            0x81, 0x00, 0x00, 0x0a, // VLAN tag, vid 10
            0x08, 0x00, // inner IPv4
        ];
        frame.extend_from_slice(&[0x45; 20]);
        let mut r = Reader::new(&frame);
        let (kind, _rest) = ethernet(&mut r).unwrap();
        assert_eq!(kind, EtherPayload::Ipv4);
    }

    #[test]
    fn truncated_ipv4_is_error_not_panic() {
        let short = [0x45, 0x00, 0x00];
        let mut r = Reader::new(&short);
        assert!(ipv4(&mut r).is_err());
    }

    #[test]
    fn udp_payload_clamped_to_length() {
        // ports 53->53, length 12 (8 header + 4 payload), then 6 bytes present
        let pkt = [0, 53, 0, 53, 0, 12, 0, 0, 1, 2, 3, 4, 5, 6];
        let mut r = Reader::new(&pkt);
        let (u, payload) = udp(&mut r).unwrap();
        assert_eq!(u.payload_len, 4);
        assert_eq!(payload, &[1, 2, 3, 4]);
    }
}
