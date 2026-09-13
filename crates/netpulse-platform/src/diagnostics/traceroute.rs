//! Multi-Transport Incremental TTL Traceroute Diagnostic Probe.
//!
//! On Windows, utilizes `iphlpapi.dll` (`IcmpCreateFile`, `IcmpSendEcho`, `IcmpCloseHandle`),
//! setting `IpOptionInformation.ttl` incrementally from 1 to `max_hops`, and capturing
//! `IP_TTL_EXPIRED_TRANSIT` (ICMP Type 11, Code 0) responses.
//! On Unix, utilizes unprivileged ICMP datagram sockets (`AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`)
//! with incremental socket TTL (`IP_TTL`).

use super::models::{TracerouteHop, TracerouteOutput};
use super::ping::resolve_target_ipv4;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug)]
pub struct TracerouteProbe {
    pub target: String,
    pub transport: String,
    pub max_hops: u8,
}

impl TracerouteProbe {
    pub fn new(target: String, transport: String, max_hops: u8) -> Self {
        Self {
            target,
            transport,
            max_hops,
        }
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod platform {
    use std::ffi::{c_void, CStr};
    use std::net::Ipv4Addr;
    use std::os::raw::c_char;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    type Handle = *mut c_void;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct IpOptionInformation {
        pub ttl: u8,
        pub tos: u8,
        pub flags: u8,
        pub options_size: u8,
        pub options_data: *mut u8,
    }

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct IcmpEchoReply {
        pub address: u32,
        pub status: u32,
        pub round_trip_time: u32,
        pub data_size: u16,
        pub reserved: u16,
        pub data: *mut u8,
        pub options: IpOptionInformation,
    }

    #[link(name = "iphlpapi")]
    extern "system" {
        fn IcmpCreateFile() -> Handle;
        fn IcmpCloseHandle(icmp_handle: Handle) -> i32;
        fn IcmpSendEcho(
            icmp_handle: Handle,
            destination_address: u32,
            request_data: *const u8,
            request_size: u16,
            request_options: *const IpOptionInformation,
            reply_buffer: *mut u8,
            reply_size: u32,
            timeout: u32,
        ) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLastError() -> u32;
    }

    #[repr(C)]
    struct SockAddrIn {
        sin_family: u16,
        sin_port: u16,
        sin_addr: u32,
        sin_zero: [u8; 8],
    }

    #[link(name = "ws2_32")]
    extern "system" {
        fn getnameinfo(
            sa: *const SockAddrIn,
            salen: i32,
            host: *mut c_char,
            hostlen: u32,
            serv: *mut c_char,
            servlen: u32,
            flags: i32,
        ) -> i32;
    }

    struct SafeIcmpHandle(Handle);

    impl Drop for SafeIcmpHandle {
        fn drop(&mut self) {
            if self.0 != INVALID_HANDLE_VALUE && !self.0.is_null() {
                unsafe {
                    IcmpCloseHandle(self.0);
                }
            }
        }
    }

    pub fn reverse_dns_lookup(ip: Ipv4Addr) -> Option<String> {
        const NI_NAMEREQD: i32 = 0x04;
        const NI_MAXHOST: usize = 1025;

        let sa = SockAddrIn {
            sin_family: 2, // AF_INET
            sin_port: 0,
            sin_addr: u32::from_ne_bytes(ip.octets()),
            sin_zero: [0; 8],
        };

        // Ensure WinSock is initialized by invoking std::net's internal initializer
        static WINSOCK_INIT: std::sync::Once = std::sync::Once::new();
        WINSOCK_INIT.call_once(|| {
            let _ = std::net::UdpSocket::bind("127.0.0.1:0");
        });

        let mut host_buf = [0 as c_char; NI_MAXHOST];
        let res = unsafe {
            getnameinfo(
                &sa as *const SockAddrIn,
                std::mem::size_of::<SockAddrIn>() as i32,
                host_buf.as_mut_ptr(),
                NI_MAXHOST as u32,
                std::ptr::null_mut(),
                0,
                NI_NAMEREQD,
            )
        };

        if res == 0 {
            let c_str = unsafe { CStr::from_ptr(host_buf.as_ptr()) };
            if let Ok(s) = c_str.to_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() && trimmed != ip.to_string() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    #[derive(Debug, Clone)]
    pub enum HopProbeResult {
        ReachedTarget { ip: Ipv4Addr, rtt_ms: f32 },
        IntermediateHop { ip: Ipv4Addr, rtt_ms: f32 },
        Timeout,
    }

    fn probe_hop(
        handle: Handle,
        dest_addr: u32,
        dest_ip: Ipv4Addr,
        ttl: u8,
        timeout_ms: u32,
    ) -> HopProbeResult {
        let request_data = b"NetPulseTracerouteProbeHopData32";
        let reply_size = (std::mem::size_of::<IcmpEchoReply>() + request_data.len() + 1024) as u32;
        let mut reply_buffer = vec![0u8; reply_size as usize];

        let options = IpOptionInformation {
            ttl,
            tos: 0,
            flags: 0,
            options_size: 0,
            options_data: std::ptr::null_mut(),
        };

        let start = Instant::now();
        let replies = unsafe {
            IcmpSendEcho(
                handle,
                dest_addr,
                request_data.as_ptr(),
                request_data.len() as u16,
                &options as *const IpOptionInformation,
                reply_buffer.as_mut_ptr(),
                reply_size,
                timeout_ms,
            )
        };
        let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;

        let reply = unsafe {
            std::ptr::read_unaligned(reply_buffer.as_ptr() as *const IcmpEchoReply)
        };

        let last_err = if replies == 0 {
            unsafe { GetLastError() }
        } else {
            0
        };

        // Status codes:
        // IP_SUCCESS = 0
        // IP_TTL_EXPIRED_TRANSIT = 11013
        // IP_TTL_EXPIRED_REASSEM = 11014
        // IP_DEST_NET_UNREACHABLE = 11002
        // IP_DEST_HOST_UNREACHABLE = 11003
        // IP_DEST_PROT_UNREACHABLE = 11004
        // IP_DEST_PORT_UNREACHABLE = 11005
        let has_reply = replies > 0
            || (reply.address != 0
                && (reply.status == 11013
                    || reply.status == 11014
                    || (11002..=11005).contains(&reply.status)
                    || last_err == 11013
                    || last_err == 11014
                    || (11002..=11005).contains(&last_err)));

        if has_reply && reply.address != 0 {
            let hop_ip = Ipv4Addr::from(reply.address.to_ne_bytes());
            let rtt = if reply.round_trip_time > 0 {
                if (elapsed_ms - reply.round_trip_time as f32).abs() < 50.0 {
                    elapsed_ms
                } else {
                    reply.round_trip_time as f32
                }
            } else {
                elapsed_ms.max(0.1)
            };

            if reply.status == 0 || hop_ip == dest_ip {
                HopProbeResult::ReachedTarget {
                    ip: hop_ip,
                    rtt_ms: rtt,
                }
            } else {
                HopProbeResult::IntermediateHop {
                    ip: hop_ip,
                    rtt_ms: rtt,
                }
            }
        } else {
            HopProbeResult::Timeout
        }
    }

    pub fn trace_target(
        dest_ip: Ipv4Addr,
        max_hops: u8,
        cancel: &AtomicBool,
    ) -> Vec<(u8, HopProbeResult)> {
        let handle = unsafe { IcmpCreateFile() };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Vec::new();
        }
        let _guard = SafeIcmpHandle(handle);
        let dest_addr = u32::from_ne_bytes(dest_ip.octets());
        let mut results = Vec::new();

        for ttl in 1..=max_hops {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            let res = probe_hop(handle, dest_addr, dest_ip, ttl, 500);
            let is_reached = matches!(res, HopProbeResult::ReachedTarget { .. });
            results.push((ttl, res));
            if is_reached {
                break;
            }
        }

        results
    }
}

#[cfg(unix)]
#[allow(unsafe_code)]
mod platform {
    use std::ffi::CStr;
    use std::net::Ipv4Addr;
    use std::os::raw::c_char;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    fn icmp_checksum(data: &[u8]) -> u16 {
        let mut sum = 0u32;
        for chunk in data.chunks_exact(2) {
            sum = sum.wrapping_add(u16::from_be_bytes([chunk[0], chunk[1]]) as u32);
        }
        if let Some(&rem) = data.chunks_exact(2).remainder().first() {
            sum = sum.wrapping_add((rem as u32) << 8);
        }
        while (sum >> 16) > 0 {
            sum = (sum & 0xffff) + (sum >> 16);
        }
        !(sum as u16)
    }

    pub fn reverse_dns_lookup(ip: Ipv4Addr) -> Option<String> {
        let mut sa: libc::sockaddr_in = unsafe { std::mem::zeroed() };
        sa.sin_family = libc::AF_INET as libc::sa_family_t;
        sa.sin_addr.s_addr = u32::from_ne_bytes(ip.octets());

        let mut host_buf = [0 as c_char; 1025];
        let res = unsafe {
            libc::getnameinfo(
                &sa as *const _ as *const libc::sockaddr,
                std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
                host_buf.as_mut_ptr(),
                host_buf.len() as libc::socklen_t,
                std::ptr::null_mut(),
                0,
                libc::NI_NAMEREQD,
            )
        };

        if res == 0 {
            let c_str = unsafe { CStr::from_ptr(host_buf.as_ptr()) };
            if let Ok(s) = c_str.to_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() && trimmed != ip.to_string() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    #[derive(Debug, Clone)]
    pub enum HopProbeResult {
        ReachedTarget { ip: Ipv4Addr, rtt_ms: f32 },
        IntermediateHop { ip: Ipv4Addr, rtt_ms: f32 },
        Timeout,
    }

    struct TraceSocket {
        fd: libc::c_int,
    }

    impl TraceSocket {
        fn open() -> Option<Self> {
            let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP) };
            if fd < 0 {
                None
            } else {
                Some(Self { fd })
            }
        }

        fn probe_hop(
            &self,
            dest_ip: Ipv4Addr,
            ttl: u8,
            timeout_ms: u32,
        ) -> HopProbeResult {
            let timeout = libc::timeval {
                tv_sec: (timeout_ms / 1000) as libc::time_t,
                tv_usec: ((timeout_ms % 1000) * 1000) as libc::suseconds_t,
            };
            unsafe {
                libc::setsockopt(
                    self.fd,
                    libc::SOL_SOCKET,
                    libc::SO_RCVTIMEO,
                    &timeout as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::timeval>() as libc::socklen_t,
                );
                libc::setsockopt(
                    self.fd,
                    libc::SOL_SOCKET,
                    libc::SO_SNDTIMEO,
                    &timeout as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::timeval>() as libc::socklen_t,
                );
                let ttl_val = ttl as libc::c_int;
                libc::setsockopt(
                    self.fd,
                    libc::IPPROTO_IP,
                    libc::IP_TTL,
                    &ttl_val as *const _ as *const libc::c_void,
                    std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                );
            }

            let mut dest_addr: libc::sockaddr_in = unsafe { std::mem::zeroed() };
            dest_addr.sin_family = libc::AF_INET as libc::sa_family_t;
            dest_addr.sin_addr.s_addr = u32::from_ne_bytes(dest_ip.octets());

            let mut packet = [0u8; 16];
            packet[0] = 8; // ICMP Echo Request
            packet[1] = 0; // Code
            let seq = (ttl as u16).to_be_bytes();
            packet[6] = seq[0];
            packet[7] = seq[1];
            packet[8..16].copy_from_slice(b"NetPulse");
            let csum = icmp_checksum(&packet);
            packet[2..4].copy_from_slice(&csum.to_be_bytes());

            let start = Instant::now();
            let send_res = unsafe {
                libc::sendto(
                    self.fd,
                    packet.as_ptr() as *const libc::c_void,
                    packet.len(),
                    0,
                    &dest_addr as *const _ as *const libc::sockaddr,
                    std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
                )
            };

            if send_res < 0 {
                return HopProbeResult::Timeout;
            }

            let mut recv_buf = [0u8; 256];
            let mut from_addr: libc::sockaddr_in = unsafe { std::mem::zeroed() };
            let mut from_len = std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t;

            let recv_res = unsafe {
                libc::recvfrom(
                    self.fd,
                    recv_buf.as_mut_ptr() as *mut libc::c_void,
                    recv_buf.len(),
                    0,
                    &mut from_addr as *mut _ as *mut libc::sockaddr,
                    &mut from_len,
                )
            };

            let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;

            if recv_res >= 8 {
                let hop_ip = Ipv4Addr::from(from_addr.sin_addr.s_addr.to_ne_bytes());
                let icmp_type = recv_buf[0];
                if icmp_type == 0 || hop_ip == dest_ip {
                    HopProbeResult::ReachedTarget {
                        ip: hop_ip,
                        rtt_ms: elapsed_ms,
                    }
                } else {
                    HopProbeResult::IntermediateHop {
                        ip: hop_ip,
                        rtt_ms: elapsed_ms,
                    }
                }
            } else {
                HopProbeResult::Timeout
            }
        }
    }

    impl Drop for TraceSocket {
        fn drop(&mut self) {
            if self.fd >= 0 {
                unsafe {
                    libc::close(self.fd);
                }
            }
        }
    }

    pub fn trace_target(
        dest_ip: Ipv4Addr,
        max_hops: u8,
        cancel: &AtomicBool,
    ) -> Vec<(u8, HopProbeResult)> {
        let Some(socket) = TraceSocket::open() else {
            return Vec::new();
        };
        let mut results = Vec::new();

        for ttl in 1..=max_hops {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            let res = socket.probe_hop(dest_ip, ttl, 500);
            let is_reached = matches!(res, HopProbeResult::ReachedTarget { .. });
            results.push((ttl, res));
            if is_reached {
                break;
            }
        }

        results
    }
}

#[cfg(not(any(windows, unix)))]
mod platform {
    use std::net::Ipv4Addr;
    use std::sync::atomic::AtomicBool;

    #[derive(Debug, Clone)]
    pub enum HopProbeResult {
        ReachedTarget { ip: Ipv4Addr, rtt_ms: f32 },
        IntermediateHop { ip: Ipv4Addr, rtt_ms: f32 },
        Timeout,
    }

    pub fn reverse_dns_lookup(_ip: Ipv4Addr) -> Option<String> {
        None
    }

    pub fn trace_target(
        _dest_ip: Ipv4Addr,
        _max_hops: u8,
        _cancel: &AtomicBool,
    ) -> Vec<(u8, HopProbeResult)> {
        Vec::new()
    }
}

pub(crate) fn reverse_resolve_with_timeout(ip: Ipv4Addr) -> Option<String> {
    use std::sync::mpsc;
    use std::thread;

    let (tx, rx) = mpsc::channel();
    let _ = thread::Builder::new()
        .name("traceroute-rdns".to_string())
        .spawn(move || {
            let res = platform::reverse_dns_lookup(ip);
            let _ = tx.send(res);
        });

    rx.recv_timeout(Duration::from_millis(600)).unwrap_or(None)
}

impl DiagnosticProbe for TracerouteProbe {
    type Output = TracerouteOutput;

    fn run(&self, cancel: AtomicBool) -> Result<Self::Output> {
        let max = if self.max_hops == 0 {
            30
        } else {
            self.max_hops.min(64)
        };

        if cancel.load(Ordering::Relaxed) {
            return Ok(TracerouteOutput {
                target: self.target.clone(),
                hops: Vec::new(),
                source: "live".to_string(),
            });
        }

        let Some(dest_ip) = resolve_target_ipv4(&self.target) else {
            return Ok(TracerouteOutput {
                target: self.target.clone(),
                hops: Vec::new(),
                source: "live".to_string(),
            });
        };

        if dest_ip.is_unspecified() || dest_ip.is_broadcast() || dest_ip.is_multicast() {
            return Ok(TracerouteOutput {
                target: self.target.clone(),
                hops: Vec::new(),
                source: "live".to_string(),
            });
        }

        let probe_results = platform::trace_target(dest_ip, max, &cancel);
        let mut hops = Vec::with_capacity(probe_results.len());
        let mut dns_cache: HashMap<Ipv4Addr, Option<String>> = HashMap::new();

        for (ttl, res) in probe_results {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            match res {
                platform::HopProbeResult::ReachedTarget { ip, rtt_ms }
                | platform::HopProbeResult::IntermediateHop { ip, rtt_ms } => {
                    let hostname = dns_cache
                        .entry(ip)
                        .or_insert_with(|| reverse_resolve_with_timeout(ip))
                        .clone();
                    hops.push(TracerouteHop {
                        ttl,
                        ip: ip.to_string(),
                        hostname,
                        rtt_ms: (rtt_ms.max(0.01) * 100.0).round() / 100.0,
                        status: "Reached".to_string(),
                    });
                }
                platform::HopProbeResult::Timeout => {
                    hops.push(TracerouteHop {
                        ttl,
                        ip: "*".to_string(),
                        hostname: None,
                        rtt_ms: 0.0,
                        status: "timeout".to_string(),
                    });
                }
            }
        }

        Ok(TracerouteOutput {
            target: self.target.clone(),
            hops,
            source: "live".to_string(),
        })
    }
}
