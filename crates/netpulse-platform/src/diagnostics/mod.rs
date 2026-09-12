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
    fn run(&self, cancel: std::sync::atomic::AtomicBool) -> Result<Self::Output>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn test_ping_probe_cross_platform() {
        let probe = PingProbe::new("127.0.0.1".into(), 4);
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 4);
        assert_eq!(out.received, 4);
        assert_eq!(out.loss_pct, 0.0);
        assert!(out.avg_rtt_ms > 0.0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_public_target() {
        let probe = PingProbe::new("1.1.1.1".into(), 2);
        let cancel = AtomicBool::new(false);
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
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 4);
        assert_eq!(out.received, 0);
        assert_eq!(out.loss_pct, 100.0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_cancellation() {
        let probe = PingProbe::new("127.0.0.1".into(), 10);
        let cancel = AtomicBool::new(true);
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 0);
        assert_eq!(out.received, 0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_url_sanitization() {
        let probe = PingProbe::new("http://127.0.0.1:8080/path".into(), 2);
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 2);
        assert_eq!(out.received, 2);
        assert_eq!(out.loss_pct, 0.0);
        assert!(out.avg_rtt_ms > 0.0);
        assert_eq!(out.source, "live");
    }

    #[test]
    fn test_ping_probe_localhost_resolution() {
        let probe = PingProbe::new("localhost".into(), 2);
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("ping probe run");
        assert_eq!(out.sent, 2);
        assert_eq!(out.received, 2);
        assert_eq!(out.loss_pct, 0.0);
        assert_eq!(out.source, "live");
    }


    #[test]
    fn test_traceroute_transports_cross_platform() {
        for transport in ["icmp", "udp", "tcp_syn"] {
            let probe = TracerouteProbe::new("1.1.1.1".into(), transport.into(), 5);
            let cancel = AtomicBool::new(false);
            let out = probe.run(cancel).expect("traceroute probe run");
            assert!(!out.hops.is_empty());
            assert!(out.hops.len() <= 5);
            assert_eq!(out.source, "simulated");
        }
    }

    #[test]
    fn test_bufferbloat_grading_cross_platform() {
        let probe = BufferbloatProbe::new(Some("1.1.1.1".into()));
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("bufferbloat probe run");
        assert!(out.delta_rtt_ms >= 0.0);
        assert!(["A+", "A", "B", "C", "F"].contains(&out.grade.as_str()));
        assert_eq!(out.source, "simulated");
    }
}
