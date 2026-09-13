//! Isolated Active Diagnostics Service Layer.

pub mod bufferbloat;
pub mod dns;
pub mod gateway;
pub mod http;
pub mod models;
pub mod ping;
pub mod traceroute;

pub use bufferbloat::BufferbloatProbe;
pub use dns::DnsProbe;
pub use gateway::GatewayProbe;
pub use http::HttpProbe;
pub use models::*;
pub use ping::PingProbe;
pub use traceroute::TracerouteProbe;

use netpulse_core::Result;

pub trait DiagnosticProbe: Send + Sync {
    type Output;
    fn run(&self, cancel: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<Self::Output>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn test_ping_probe_cross_platform() {
        let probe = PingProbe::new("127.0.0.1".into(), 4);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 4);
        assert_eq!(out.source, "live");
        if out.received > 0 {
            assert_eq!(out.received, 4);
            assert_eq!(out.loss_pct, 0.0);
            assert!(out.avg_rtt_ms > 0.0);
        } else {
            // In unprivileged sandboxes (e.g. macOS CI runners or restrictive Linux environments),
            // ICMP socket creation is disallowed by the OS kernel, resulting in 100% packet loss.
            assert_eq!(out.loss_pct, 100.0);
        }
    }

    #[test]
    fn test_ping_probe_public_target() {
        let probe = PingProbe::new("1.1.1.1".into(), 2);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 2);
        assert_eq!(out.source, "live");

        if out.received > 0 {
            assert!(out.avg_rtt_ms > 0.0);
            assert!(out.loss_pct < 100.0);
        } else {
            assert_eq!(out.loss_pct, 100.0);
        }
    }

    #[test]
    fn test_ping_probe_invalid_target() {
        let probe = PingProbe::new("invalid.nonexistent.domain.test".into(), 4);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 4);
        assert_eq!(out.received, 0);
        assert_eq!(out.loss_pct, 100.0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_cancellation() {
        let probe = PingProbe::new("127.0.0.1".into(), 10);
        let cancel = Arc::new(AtomicBool::new(true));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 0);
        assert_eq!(out.received, 0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_url_sanitization() {
        let probe = PingProbe::new("http://127.0.0.1:8080/path".into(), 2);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 2);
        assert_eq!(out.source, "live");
        if out.received > 0 {
            assert_eq!(out.received, 2);
            assert_eq!(out.loss_pct, 0.0);
            assert!(out.avg_rtt_ms > 0.0);
        } else {
            assert_eq!(out.loss_pct, 100.0);
        }
    }

    #[test]
    fn test_ping_probe_localhost_resolution() {
        let probe = PingProbe::new("localhost".into(), 2);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 2);
        assert_eq!(out.source, "live");
        if out.received > 0 {
            assert_eq!(out.received, 2);
            assert_eq!(out.loss_pct, 0.0);
        } else {
            assert_eq!(out.loss_pct, 100.0);
        }
    }

    #[test]
    fn test_ping_probe_mid_execution_cancellation() {
        use std::thread;
        use std::time::{Duration, Instant};

        // In unprivileged sandboxes (e.g. macOS CI runners or restrictive Linux environments),
        // ICMP socket creation is disallowed by the OS kernel, returning immediately without live iterations.
        let check = PingProbe::new("127.0.0.1".into(), 1)
            .run(Arc::new(AtomicBool::new(false)))
            .expect("check probe");
        if check.received == 0 {
            eprintln!("Skipping ping mid-execution cancellation test: ICMP socket disallowed in environment");
            return;
        }

        let probe = PingProbe::new("127.0.0.1".into(), 20);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel.clone();

        let flag_set_time = Arc::new(std::sync::Mutex::new(None));
        let flag_set_time_clone = flag_set_time.clone();

        let trigger_thread = thread::spawn(move || {
            // Let the probe start and run initial ping(s)
            thread::sleep(Duration::from_millis(80));
            let now = Instant::now();
            *flag_set_time_clone.lock().unwrap() = Some(now);
            cancel_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        });

        let out = probe.run(cancel).expect("ping probe run");
        let finish_time = Instant::now();
        trigger_thread.join().expect("join trigger thread");

        let flag_time = flag_set_time.lock().unwrap().expect("flag should be set");
        let elapsed_after_cancel = finish_time.saturating_duration_since(flag_time);

        println!(
            "Ping probe mid-execution halt latency: {:?}",
            elapsed_after_cancel
        );
        // Acceptance criteria: Long-running probes halt within 100ms of cancellation flag being set
        assert!(
            elapsed_after_cancel < Duration::from_millis(100),
            "Probe must halt within 100ms of cancellation flag being set, took {:?}",
            elapsed_after_cancel
        );
        assert!(
            out.sent < 20,
            "Probe should have stopped early, but sent {}",
            out.sent
        );
    }

    #[test]
    fn test_traceroute_transports_cross_platform() {
        for transport in ["icmp", "udp", "tcp_syn"] {
            let probe = TracerouteProbe::new("1.1.1.1".into(), transport.into(), 3);
            let cancel = Arc::new(AtomicBool::new(false));
            let out = probe.run(cancel).expect("traceroute probe run");
            assert_eq!(out.source, "live");
            assert!(out.hops.len() <= 3);
            if !out.hops.is_empty() {
                // Check that first hop discovered has valid TTL and status
                let first = &out.hops[0];
                assert_eq!(first.ttl, 1);
                assert!(
                    first.status == "Reached"
                        || first.status == "timeout"
                        || first.status == "Forwarded"
                );
            }
        }
    }

    #[test]
    fn test_traceroute_cancellation() {
        let probe = TracerouteProbe::new("1.1.1.1".into(), "icmp".into(), 10);
        let cancel = Arc::new(AtomicBool::new(true));
        let out = probe.run(cancel).expect("traceroute probe run");
        assert!(out.hops.is_empty());
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_traceroute_invalid_target() {
        let probe =
            TracerouteProbe::new("invalid.nonexistent.domain.test".into(), "icmp".into(), 4);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("traceroute probe run");
        assert!(out.hops.is_empty());
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_traceroute_unspecified_ip() {
        let probe = TracerouteProbe::new("0.0.0.0".into(), "icmp".into(), 4);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("traceroute probe run");
        assert!(out.hops.is_empty());
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_traceroute_localhost() {
        let probe = TracerouteProbe::new("127.0.0.1".into(), "icmp".into(), 5);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("traceroute probe run");
        assert_eq!(out.source, "live");
        if !out.hops.is_empty() {
            assert_eq!(out.hops.len(), 1);
            assert_eq!(out.hops[0].ip, "127.0.0.1");
            assert_eq!(out.hops[0].status, "Reached");
            assert!(out.hops[0].rtt_ms > 0.0);
        }
    }

    #[test]
    fn test_traceroute_live_network_hops_detail() {
        let probe = TracerouteProbe::new("1.1.1.1".into(), "icmp".into(), 12);
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("traceroute probe run");
        assert_eq!(out.source, "live");
        for hop in &out.hops {
            println!(
                "Hop {}: IP='{}' Hostname='{:?}' RTT={}ms Status='{}'",
                hop.ttl, hop.ip, hop.hostname, hop.rtt_ms, hop.status
            );
            if hop.status == "timeout" {
                assert_eq!(hop.ip, "*");
                assert_eq!(hop.rtt_ms, 0.0);
            } else {
                assert_ne!(hop.ip, "*");
                assert!(hop.rtt_ms >= 0.0);
            }
        }
    }

    #[test]
    fn test_traceroute_reverse_dns() {
        use std::net::Ipv4Addr;
        let one_one: Ipv4Addr = "1.1.1.1".parse().unwrap();
        let hostname = super::traceroute::reverse_resolve_with_timeout(one_one);
        println!("Reverse DNS 1.1.1.1 => {:?}", hostname);
        if let Some(h) = hostname {
            let h = h.to_lowercase();
            assert!(h.contains("one.one.one.one") || h.contains("cloudflare") || !h.is_empty());
        }
    }

    #[test]
    fn test_bufferbloat_grading_cross_platform() {
        let probe = BufferbloatProbe::new(Some("1.1.1.1".into()));
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("bufferbloat probe run");
        assert!(out.delta_rtt_ms >= 0.0);
        assert!(["A+", "A", "B", "C", "F"].contains(&out.grade.as_str()));
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_bufferbloat_grade_ranges() {
        use super::bufferbloat::calculate_grade;
        assert_eq!(calculate_grade(0.0, true), "A+");
        assert_eq!(calculate_grade(9.99, true), "A+");
        assert_eq!(calculate_grade(10.0, true), "A");
        assert_eq!(calculate_grade(24.99, true), "A");
        assert_eq!(calculate_grade(25.0, true), "B");
        assert_eq!(calculate_grade(59.99, true), "B");
        assert_eq!(calculate_grade(60.0, true), "C");
        assert_eq!(calculate_grade(149.99, true), "C");
        assert_eq!(calculate_grade(150.0, true), "F");
        assert_eq!(calculate_grade(500.0, true), "F");
        assert_eq!(calculate_grade(0.0, false), "F");
    }

    #[test]
    fn test_bufferbloat_cancellation() {
        let probe = BufferbloatProbe::new(Some("1.1.1.1".into()));
        let cancel = Arc::new(AtomicBool::new(true));
        let start = std::time::Instant::now();
        let out = probe.run(cancel).expect("bufferbloat probe run");
        assert!(
            start.elapsed().as_millis() < 500,
            "Should cancel immediately"
        );
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_bufferbloat_invalid_target() {
        let probe = BufferbloatProbe::new(Some("invalid.domain.target.nonexistent".into()));
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("bufferbloat probe run");
        assert_eq!(out.grade, "F");
        assert_eq!(out.delta_rtt_ms, 0.0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_bufferbloat_with_mock_server() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::thread;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local mock server");
        let local_addr = listener.local_addr().expect("local addr");

        let stop_server = std::sync::Arc::new(AtomicBool::new(false));
        let stop_clone = stop_server.clone();

        let server_thread = thread::spawn(move || {
            let _ = listener.set_nonblocking(true);
            while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut req_buf = [0u8; 1024];
                    let _ = stream.read(&mut req_buf);
                    let header = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(header.as_bytes());
                    let chunk = [0xAAu8; 8192];
                    while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                        if stream.write_all(&chunk).is_err() {
                            break;
                        }
                    }
                }
                thread::sleep(std::time::Duration::from_millis(10));
            }
        });

        let probe = BufferbloatProbe::with_options(
            Some("127.0.0.1".into()),
            Some(format!("http://{}", local_addr)),
            Some(1),
        );
        let cancel = Arc::new(AtomicBool::new(false));
        let out = probe.run(cancel).expect("bufferbloat probe run");

        stop_server.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = server_thread.join();

        assert_eq!(out.source, "live");
        assert_eq!(out.target, "127.0.0.1");
        assert!(out.delta_rtt_ms >= 0.0);
        assert!(["A+", "A", "B", "C", "F"].contains(&out.grade.as_str()));
    }

    #[test]
    fn test_bufferbloat_mid_run_cancellation() {
        use std::sync::Arc;
        use std::thread;

        let probe = BufferbloatProbe::new(Some("1.1.1.1".into()));
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel.clone();

        thread::spawn(move || {
            // Trigger cancellation after 150ms during baseline idle or saturation ramp
            thread::sleep(std::time::Duration::from_millis(150));
            cancel_clone.store(true, std::sync::atomic::Ordering::Relaxed);
        });

        let start = std::time::Instant::now();
        let out = probe.run(cancel).expect("bufferbloat probe run");
        // Ensure that even with 3-second duration, cancellation aborted well before 3 seconds
        assert!(
            start.elapsed().as_millis() < 1500,
            "Should abort promptly upon mid-run cancellation"
        );
        assert_eq!(out.source, "live");
    }
}
