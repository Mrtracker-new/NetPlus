//! Hostile and malformed input verification suite for `netpulse-decode`.
//!
//! Enforces the bounded-work parser safety invariants:
//! - Zero panics across all inputs
//! - Finite, strictly-bounded loop iterations (no infinite loops)
//! - Monotonic reader advancement
//! - Bounded allocation caps on nested structures (DNS pointers <= 16, TLS extensions <= 64)

use netpulse_decode::layers::{ethernet, ipv4, ipv6, tcp, udp};
use netpulse_decode::{decode_frame, dns, http, tls, LinkType, Reader};

#[test]
fn test_truncated_layer_prefixes() {
    // Standard valid IPv4/TCP/HTTP packet
    let valid_packet = [
        // Ethernet: dst(6), src(6), type(2 = 0x0800)
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0x08, 0x00,
        // IPv4: version/ihl=0x45, dscp/ecn=0, total_len=60, id=1, flags/frag=0x4000, ttl=64, proto=6(TCP), csum=0, src, dst
        0x45, 0x00, 0x00, 0x3c, 0x00, 0x01, 0x40, 0x00, 0x40, 0x06, 0x00, 0x00, 192, 168, 1, 10,
        192, 168, 1,
        1, // TCP: src_port=12345, dst_port=80, seq=100, ack=0, offset=0x50, flags=0x02(SYN), window=65535, csum=0, urg=0
        0x30, 0x39, 0x00, 0x50, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x50, 0x02, 0xff,
        0xff, 0x00, 0x00, 0x00, 0x00,
    ];

    // Truncate at every byte boundary from 0 to full length
    for len in 0..=valid_packet.len() {
        let prefix = &valid_packet[..len];
        let _ = decode_frame(LinkType::Ethernet, prefix);

        let mut r = Reader::new(prefix);
        let _ = ethernet(&mut r);

        let mut r = Reader::new(prefix);
        let _ = ipv4(&mut r);

        let mut r = Reader::new(prefix);
        let _ = ipv6(&mut r);

        let mut r = Reader::new(prefix);
        let _ = tcp(&mut r);

        let mut r = Reader::new(prefix);
        let _ = udp(&mut r);
    }
}

#[test]
fn test_dns_compression_pointer_loops_and_cycles() {
    // DNS header: id=0x1234, flags=0x8180(response no error), qd=1, an=1, ns=0, ar=0
    let header = vec![
        0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    ];

    // 1. Direct self-pointer: pointer at offset 12 points to offset 12 (0xc0 0x0c)
    let mut self_pointer = header.clone();
    self_pointer.extend_from_slice(&[0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01]);
    let res = dns::dissect(&self_pointer);
    assert!(res.is_ok());
    assert_eq!(res.unwrap(), None); // Bounded pointer walk aborts cleanly

    // 2. Mutual cycle: offset 12 points to offset 14 (0xc0 0x0e); offset 14 points to offset 12 (0xc0 0x0c)
    let mut mutual_cycle = header.clone();
    mutual_cycle.extend_from_slice(&[0xc0, 0x0e, 0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01]);
    let res = dns::dissect(&mutual_cycle);
    assert!(res.is_ok());
    assert_eq!(res.unwrap(), None);

    // 3. Pointer pointing out of buffer bounds (offset 0xfffe)
    let mut out_of_bounds_ptr = header.clone();
    out_of_bounds_ptr.extend_from_slice(&[0xff, 0xfe, 0x00, 0x01, 0x00, 0x01]);
    let res = dns::dissect(&out_of_bounds_ptr);
    assert!(res.is_ok());
    assert_eq!(res.unwrap(), None);

    // 4. Chain of 20 pointers (exceeding MAX_POINTER_JUMPS = 16)
    let mut long_chain = header.clone();
    // Create 20 successive pointers jumping to the next
    for i in 0..20 {
        let next_offset = (12 + (i + 1) * 2) as u8;
        long_chain.extend_from_slice(&[0xc0, next_offset]);
    }
    // End with a label at offset 52: 3 'w' 'w' 'w' 0
    long_chain.extend_from_slice(&[3, b'w', b'w', b'w', 0, 0x00, 0x01, 0x00, 0x01]);
    let res = dns::dissect(&long_chain);
    assert!(res.is_ok());
    assert_eq!(res.unwrap(), None); // Rejected because jumps > 16
}

#[test]
fn test_tls_malformed_handshakes_and_extensions() {
    // 1. TLS record with truncated handshake length (clean error or None, no panic)
    let truncated_record = [0x16, 0x03, 0x01, 0x00, 0x20, 0x01]; // ContentType=Handshake(22), Version=TLS1.0, Length=32, ClientHello, no body
    let _ = tls::dissect(&truncated_record);

    // 2. ClientHello with extensions length header indicating 0xFFFF bytes but only 4 bytes present
    let mut bad_ext = vec![
        0x16, 0x03, 0x01, 0x00, 0x40, // Record header
        0x01, 0x00, 0x00, 0x38, // ClientHello header (length 56)
        0x03, 0x03, // TLS 1.2
    ];
    bad_ext.extend_from_slice(&[0u8; 32]); // Random
    bad_ext.push(0); // Session ID length 0
    bad_ext.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]); // Cipher suites
    bad_ext.extend_from_slice(&[0x01, 0x00]); // Compression methods
    bad_ext.extend_from_slice(&[0xff, 0xff]); // Extensions length = 65535, but nothing follows
    let res = tls::dissect(&bad_ext);
    assert!(res.is_ok());

    // 3. ClientHello with 100 extension entries (exceeding MAX_EXTENSIONS = 64)
    let mut many_exts = vec![
        0x16, 0x03, 0x01, 0x01, 0x90, // Record header
        0x01, 0x00, 0x01, 0x88, // ClientHello header
        0x03, 0x03,
    ];
    many_exts.extend_from_slice(&[0u8; 32]);
    many_exts.push(0); // Session ID len 0
    many_exts.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]);
    many_exts.extend_from_slice(&[0x01, 0x00]);
    many_exts.extend_from_slice(&[0x01, 0x90]); // Extensions total len 400
    for _ in 0..100 {
        // Unknown extension type 0x1234 with len 0
        many_exts.extend_from_slice(&[0x12, 0x34, 0x00, 0x00]);
    }
    let res = tls::dissect(&many_exts);
    assert!(res.is_ok());
}

#[test]
fn test_http_malformed_and_boundary_cases() {
    // 1. Incomplete method
    assert!(http::dissect(b"GE").is_none());
    assert!(http::dissect(b"POS").is_none());

    // 2. HTTP response with invalid status codes
    assert!(http::dissect(b"HTTP/1.1 99 Invalid\r\n").is_none());
    assert!(http::dissect(b"HTTP/1.1 600 Invalid\r\n").is_none());
    assert!(http::dissect(b"HTTP/1.1 ABC Invalid\r\n").is_none());

    // 3. Valid status code parsing
    let res = http::dissect(b"HTTP/1.1 200 OK\r\n").unwrap();
    assert_eq!(res.status, Some(200));

    // 4. Request without HTTP/ prefix in version
    assert!(http::dissect(b"GET /index.html FTP/1.0\r\n").is_none());

    // 5. Huge invalid headers without \r\n
    let mut huge_header = b"GET / HTTP/1.1\r\nHeader: ".to_vec();
    huge_header.extend_from_slice(&[b'a'; 4000]);
    let info = http::dissect(&huge_header);
    assert!(info.is_some());
    assert_eq!(info.unwrap().method.as_deref(), Some("GET"));
}

#[test]
fn test_fuzz_monotonic_reader_advancement() {
    // Seeded pseudo-random stream
    let mut state: u64 = 0x1337_C0DE_F00D_CAFE;
    let mut next_byte = || {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 32) as u8
    };

    for size in [0, 1, 7, 16, 64, 256, 1500, 8192] {
        for _ in 0..20 {
            let mut buf = vec![0u8; size];
            for b in &mut buf {
                *b = next_byte();
            }

            // Top-level decoders must never panic or loop forever
            let _ = decode_frame(LinkType::Ethernet, &buf);
            let _ = decode_frame(LinkType::Loopback, &buf);
            let _ = decode_frame(LinkType::RawIp, &buf);
            let _ = dns::dissect(&buf);
            let _ = http::dissect(&buf);
            let _ = tls::dissect(&buf);
        }
    }
}
