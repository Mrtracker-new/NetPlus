//! Read-Only Default Gateway Discovery Diagnostic Probe.

use super::models::GatewayDiscoveryOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::sync::atomic::AtomicBool;

#[derive(Debug, Default, Clone)]
pub struct GatewayProbe;

impl GatewayProbe {
    pub fn new() -> Self {
        Self
    }

    /// Read-only discovery of default gateway IP on Windows / platform.
    #[cfg(target_os = "windows")]
    fn discover_windows() -> Option<(String, Option<String>)> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // Execute read-only route print 0.0.0.0 to inspect active default route
        let output = Command::new("route")
            .args(["print", "0.0.0.0"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        // Look for lines containing "0.0.0.0" and a valid gateway IP
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Typical format: Network Destination | Netmask | Gateway | Interface | Metric
            // E.g.: 0.0.0.0  0.0.0.0  192.168.1.1  192.168.1.50  25
            if parts.len() >= 4 && parts[0] == "0.0.0.0" && parts[1] == "0.0.0.0" {
                let gw_ip = parts[2];
                let iface_ip = parts[3];
                // Ensure it's not "On-link" or 0.0.0.0
                if gw_ip != "0.0.0.0"
                    && gw_ip != "On-link"
                    && gw_ip.parse::<std::net::IpAddr>().is_ok()
                {
                    return Some((gw_ip.to_string(), Some(iface_ip.to_string())));
                }
            }
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    fn discover_unix() -> Option<(String, Option<String>)> {
        use std::process::Command;
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        // format: default via 192.168.1.1 dev eth0
        let parts: Vec<&str> = text.split_whitespace().collect();
        for i in 0..parts.len() {
            if parts[i] == "via" && i + 1 < parts.len() {
                let gw = parts[i + 1];
                if gw.parse::<std::net::IpAddr>().is_ok() {
                    let iface = if i + 3 < parts.len() && parts[i + 2] == "dev" {
                        Some(parts[i + 3].to_string())
                    } else {
                        None
                    };
                    return Some((gw.to_string(), iface));
                }
            }
        }
        None
    }
}

impl DiagnosticProbe for GatewayProbe {
    type Output = GatewayDiscoveryOutput;

    fn run(&self, cancel: AtomicBool) -> Result<Self::Output> {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(GatewayDiscoveryOutput {
                gateway_ip: None,
                interface_name: None,
                status: "cancelled".to_string(),
                source: "unavailable".to_string(),
            });
        }

        #[cfg(target_os = "windows")]
        let discovered = Self::discover_windows();

        #[cfg(not(target_os = "windows"))]
        let discovered = Self::discover_unix();

        match discovered {
            Some((gw_ip, iface)) => Ok(GatewayDiscoveryOutput {
                gateway_ip: Some(gw_ip),
                interface_name: iface,
                status: "discovered".to_string(),
                source: "live".to_string(),
            }),
            None => Ok(GatewayDiscoveryOutput {
                gateway_ip: None,
                interface_name: None,
                status: "unavailable".to_string(),
                source: "unavailable".to_string(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_probe_execution() {
        let probe = GatewayProbe::new();
        let cancel = AtomicBool::new(false);
        let out = probe.run(cancel).expect("gateway probe run");
        // Must either find a valid IP or report status unavailable without crashing
        if let Some(gw) = &out.gateway_ip {
            assert_eq!(out.source, "live");
            assert!(gw.parse::<std::net::IpAddr>().is_ok());
        } else {
            assert_eq!(out.status, "unavailable");
        }
    }
}
