//! Real Cross-Platform ICMP Echo Diagnostic Probe.
//!
//! On Windows, utilizes `iphlpapi.dll` (`IcmpCreateFile`, `IcmpSendEcho`, `IcmpCloseHandle`),
//! which operates without requiring administrative privileges.
//! On Unix, utilizes unprivileged ICMP datagram sockets (`AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`).

use super::models::PingProbeOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::net::ToSocketAddrs;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[derive(Debug)]
pub struct PingProbe {
    pub target: String,
    pub count: u32,
}

impl PingProbe {
    pub fn new(target: String, count: u32) -> Self {
        Self { target, count }
    }
}

pub(crate) fn resolve_target_ipv4(target: &str) -> Option<std::net::Ipv4Addr> {
    let trimmed = target.trim();
    // Strip any URL scheme (e.g. "https://", "http://", "HTTP://")
    let without_scheme = if let Some(idx) = trimmed.find("://") {
        &trimmed[idx + 3..]
    } else {
        trimmed
    };

    let without_path = without_scheme.split('/').next().unwrap_or("").trim();

    let cleaned = if without_path.starts_with('[') {
        if let Some(end) = without_path.find(']') {
            &without_path[1..end]
        } else {
            without_path
        }
    } else if let Some(idx) = without_path.rfind(':') {
        // Strip port only if not an IPv6 address with multiple colons
        if !without_path[..idx].contains(':') {
            &without_path[..idx]
        } else {
            without_path
        }
    } else {
        without_path
    };

    if cleaned.is_empty() {
        return None;
    }

    if let Ok(ip) = cleaned.parse::<std::net::Ipv4Addr>() {
        return Some(ip);
    }

    // Resolve domain name via OS resolver using standard port 80
    if let Ok(addrs) = (cleaned, 80).to_socket_addrs() {
        for addr in addrs {
            if let std::net::SocketAddr::V4(v4) = addr {
                return Some(*v4.ip());
            }
        }
    }

    None
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod platform {
    use std::ffi::c_void;
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

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

    pub fn ping_target(dest_ip: Ipv4Addr, count: u32, cancel: &AtomicBool) -> (u32, Vec<f32>) {
        let handle = unsafe { IcmpCreateFile() };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return (count, Vec::new());
        }
        let _guard = SafeIcmpHandle(handle);

        let dest_addr = u32::from_ne_bytes(dest_ip.octets());
        let request_data = b"NetPulseICMPPing";
        let reply_size = (std::mem::size_of::<IcmpEchoReply>() + request_data.len() + 64) as u32;
        let mut reply_buffer = vec![0u8; reply_size as usize];
        let mut samples = Vec::with_capacity(count as usize);
        let mut sent = 0;

        for i in 0..count {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            sent += 1;
            reply_buffer.fill(0);
            let start = Instant::now();
            let replies = unsafe {
                IcmpSendEcho(
                    handle,
                    dest_addr,
                    request_data.as_ptr(),
                    request_data.len() as u16,
                    std::ptr::null(),
                    reply_buffer.as_mut_ptr(),
                    reply_size,
                    1000,
                )
            };
            let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;

            if replies > 0 {
                // Read unaligned to avoid undefined behavior regarding pointer alignment
                let reply = unsafe {
                    std::ptr::read_unaligned(reply_buffer.as_ptr() as *const IcmpEchoReply)
                };
                if reply.status == 0 {
                    // IP_SUCCESS: use high-resolution elapsed time, guarding against scheduler lag
                    let rtt = if reply.round_trip_time > 0 {
                        if (elapsed_ms - reply.round_trip_time as f32).abs() < 50.0 {
                            elapsed_ms
                        } else {
                            reply.round_trip_time as f32
                        }
                    } else {
                        elapsed_ms
                    };
                    samples.push(rtt);
                }
            }

            if i + 1 < count && !cancel.load(Ordering::Relaxed) {
                let sleep_start = Instant::now();
                while sleep_start.elapsed() < Duration::from_millis(50)
                    && !cancel.load(Ordering::Relaxed)
                {
                    let remaining = Duration::from_millis(50).saturating_sub(sleep_start.elapsed());
                    std::thread::sleep(Duration::from_millis(10).min(remaining));
                }
            }
        }

        (sent, samples)
    }
}

#[cfg(unix)]
#[allow(unsafe_code)]
mod platform {
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    struct SocketGuard(libc::c_int);

    impl Drop for SocketGuard {
        fn drop(&mut self) {
            if self.0 >= 0 {
                unsafe {
                    libc::close(self.0);
                }
            }
        }
    }

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

    pub fn ping_target(dest_ip: Ipv4Addr, count: u32, cancel: &AtomicBool) -> (u32, Vec<f32>) {
        // Create unprivileged ICMP datagram socket
        let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP) };
        if fd < 0 {
            return (count, Vec::new());
        }
        let _guard = SocketGuard(fd);

        let timeout = libc::timeval {
            tv_sec: 1,
            tv_usec: 0,
        };
        unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                &timeout as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            );
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_SNDTIMEO,
                &timeout as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            );
        }

        let mut dest_addr: libc::sockaddr_in = unsafe { std::mem::zeroed() };
        dest_addr.sin_family = libc::AF_INET as libc::sa_family_t;
        dest_addr.sin_addr.s_addr = u32::from_ne_bytes(dest_ip.octets());

        let mut samples = Vec::with_capacity(count as usize);
        let mut sent = 0;

        for i in 0..count {
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            sent += 1;

            // ICMP Echo Request: Type 8, Code 0
            let mut packet = [0u8; 16];
            packet[0] = 8; // ICMP Echo Request
            packet[1] = 0; // Code
            let seq = (i as u16).to_be_bytes();
            packet[6] = seq[0];
            packet[7] = seq[1];
            packet[8..16].copy_from_slice(b"NetPulse");
            let csum = icmp_checksum(&packet);
            packet[2..4].copy_from_slice(&csum.to_be_bytes());

            let start = Instant::now();
            let send_res = unsafe {
                libc::sendto(
                    fd,
                    packet.as_ptr() as *const libc::c_void,
                    packet.len(),
                    0,
                    &dest_addr as *const _ as *const libc::sockaddr,
                    std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
                )
            };

            if send_res >= 0 {
                let mut recv_buf = [0u8; 128];
                let mut from_addr: libc::sockaddr_in = unsafe { std::mem::zeroed() };
                let mut from_len = std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t;

                let recv_res = unsafe {
                    libc::recvfrom(
                        fd,
                        recv_buf.as_mut_ptr() as *mut libc::c_void,
                        recv_buf.len(),
                        0,
                        &mut from_addr as *mut _ as *mut libc::sockaddr,
                        &mut from_len,
                    )
                };

                // Verify response is an ICMP Echo Reply (Type 0) and not an error like Type 3 (unreachable)
                if recv_res >= 8 && recv_buf[0] == 0 {
                    let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;
                    samples.push(elapsed_ms);
                }
            }

            if i + 1 < count && !cancel.load(Ordering::Relaxed) {
                let sleep_start = Instant::now();
                while sleep_start.elapsed() < Duration::from_millis(50)
                    && !cancel.load(Ordering::Relaxed)
                {
                    let remaining = Duration::from_millis(50).saturating_sub(sleep_start.elapsed());
                    std::thread::sleep(Duration::from_millis(10).min(remaining));
                }
            }
        }

        (sent, samples)
    }
}

#[cfg(not(any(windows, unix)))]
mod platform {
    use std::net::Ipv4Addr;
    use std::sync::atomic::AtomicBool;

    pub fn ping_target(_dest_ip: Ipv4Addr, count: u32, _cancel: &AtomicBool) -> (u32, Vec<f32>) {
        (count, Vec::new())
    }
}

pub(crate) use platform::ping_target;

impl DiagnosticProbe for PingProbe {
    type Output = PingProbeOutput;

    fn run(&self, cancel: Arc<AtomicBool>) -> Result<Self::Output> {
        let count = if self.count == 0 {
            4
        } else {
            self.count.min(100)
        };

        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(PingProbeOutput {
                target: self.target.clone(),
                sent: 0,
                received: 0,
                loss_pct: 0.0,
                min_rtt_ms: 0.0,
                avg_rtt_ms: 0.0,
                max_rtt_ms: 0.0,
                stddev_rtt_ms: 0.0,
                source: "live".to_string(),
            });
        }

        let Some(dest_ip) = resolve_target_ipv4(&self.target) else {
            // Invalid or unresolvable target: authentic 100% packet loss
            return Ok(PingProbeOutput {
                target: self.target.clone(),
                sent: count,
                received: 0,
                loss_pct: 100.0,
                min_rtt_ms: 0.0,
                avg_rtt_ms: 0.0,
                max_rtt_ms: 0.0,
                stddev_rtt_ms: 0.0,
                source: "live".to_string(),
            });
        };

        let (sent, samples) = platform::ping_target(dest_ip, count, &cancel);

        let received = samples.len() as u32;
        let loss_pct = if sent == 0 {
            0.0
        } else {
            ((sent.saturating_sub(received)) as f32 / sent as f32) * 100.0
        };

        let round2 = |v: f32| {
            let r = (v * 100.0).round() / 100.0;
            if v > 0.0 && r == 0.0 {
                0.01
            } else {
                r
            }
        };

        let min_rtt_ms = if samples.is_empty() {
            0.0
        } else {
            round2(samples.iter().copied().fold(f32::INFINITY, f32::min))
        };

        let max_rtt_ms = if samples.is_empty() {
            0.0
        } else {
            round2(samples.iter().copied().fold(f32::NEG_INFINITY, f32::max))
        };

        let raw_avg = if samples.is_empty() {
            0.0
        } else {
            let sum: f32 = samples.iter().sum();
            sum / samples.len() as f32
        };

        let avg_rtt_ms = round2(raw_avg);

        let stddev_rtt_ms = if samples.len() <= 1 {
            0.0
        } else {
            let variance =
                samples.iter().map(|&x| (x - raw_avg).powi(2)).sum::<f32>() / samples.len() as f32;
            round2(variance.sqrt())
        };

        Ok(PingProbeOutput {
            target: self.target.clone(),
            sent,
            received,
            loss_pct: round2(loss_pct),
            min_rtt_ms,
            avg_rtt_ms,
            max_rtt_ms,
            stddev_rtt_ms,
            source: "live".to_string(),
        })
    }
}
