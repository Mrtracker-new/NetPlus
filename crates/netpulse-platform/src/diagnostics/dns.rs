//! OS Hostname Resolution & DNS Timing Diagnostic Probe.

use super::models::DnsProbeOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::net::ToSocketAddrs;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct DnsProbe {
    pub target: String,
}

impl DnsProbe {
    pub fn new(target: String) -> Self {
        Self { target }
    }
}

impl DiagnosticProbe for DnsProbe {
    type Output = DnsProbeOutput;

    fn run(&self, cancel: AtomicBool) -> Result<Self::Output> {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(DnsProbeOutput {
                target: self.target.clone(),
                resolution_rtt_ms: None,
                resolved_ips: Vec::new(),
                timed_out: false,
                error: Some("Operation cancelled".to_string()),
                source: "live".to_string(),
            });
        }

        // Clean domain target (strip protocol schemes or ports if present)
        let trimmed = self
            .target
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("")
            .trim();

        let cleaned = if trimmed.starts_with('[') {
            if let Some(end) = trimmed.find(']') {
                &trimmed[1..end]
            } else {
                trimmed
            }
        } else if let Some(idx) = trimmed.rfind(':') {
            // Check if it's host:port (IPv4 or domain) or raw unbracketed IPv6
            if !trimmed[..idx].contains(':') {
                &trimmed[..idx]
            } else {
                trimmed
            }
        } else {
            trimmed
        };

        if cleaned.is_empty() {
            return Ok(DnsProbeOutput {
                target: self.target.clone(),
                resolution_rtt_ms: None,
                resolved_ips: Vec::new(),
                timed_out: false,
                error: Some("Invalid or empty hostname target".to_string()),
                source: "live".to_string(),
            });
        }

        // Resolve against standard port (e.g. 80) using OS resolver
        let socket_str = if cleaned.contains(':') && !cleaned.starts_with('[') {
            format!("[{cleaned}]:80")
        } else {
            format!("{cleaned}:80")
        };
        let start = Instant::now();
        match socket_str.to_socket_addrs() {
            Ok(addrs) => {
                let duration_ms = start.elapsed().as_secs_f32() * 1000.0;
                let mut ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
                ips.sort();
                ips.dedup();

                if ips.is_empty() {
                    Ok(DnsProbeOutput {
                        target: cleaned.to_string(),
                        resolution_rtt_ms: None,
                        resolved_ips: Vec::new(),
                        timed_out: false,
                        error: Some("No addresses resolved by OS resolver".to_string()),
                        source: "live".to_string(),
                    })
                } else {
                    Ok(DnsProbeOutput {
                        target: cleaned.to_string(),
                        resolution_rtt_ms: Some((duration_ms * 10.0).round() / 10.0),
                        resolved_ips: ips,
                        timed_out: false,
                        error: None,
                        source: "live".to_string(),
                    })
                }
            }
            Err(e) => {
                let err_str = e.to_string();
                let timed_out = err_str.to_lowercase().contains("timed out")
                    || err_str.to_lowercase().contains("timeout");
                Ok(DnsProbeOutput {
                    target: cleaned.to_string(),
                    resolution_rtt_ms: None,
                    resolved_ips: Vec::new(),
                    timed_out,
                    error: Some(err_str),
                    source: "live".to_string(),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dns_probe_resolves_localhost() {
        let probe = DnsProbe::new("localhost".to_string());
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("dns probe run");
        assert_eq!(out.source, "live");
        assert!(out.error.is_none());
        assert!(!out.resolved_ips.is_empty());
        assert!(out.resolution_rtt_ms.is_some());
    }

    #[test]
    fn test_dns_probe_handles_invalid_host() {
        let probe = DnsProbe::new("this-is-a-definitely-nonexistent-domain-12345.netplus.invalid".to_string());
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("dns probe run");
        assert_eq!(out.source, "live");
        assert!(out.error.is_some());
        assert!(out.resolution_rtt_ms.is_none());
        assert!(out.resolved_ips.is_empty());
    }

    #[test]
    fn test_dns_probe_handles_ipv6_target() {
        let probe = DnsProbe::new("[::1]:8080".to_string());
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("dns probe run");
        assert_eq!(out.source, "live");
        assert!(out.error.is_none());
        assert!(out.resolved_ips.contains(&"::1".to_string()));
    }
}
