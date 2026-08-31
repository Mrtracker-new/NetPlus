//! Dual-Phase Bufferbloat Latency Diagnostic Probe.

use super::models::BufferbloatOutput;
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::sync::atomic::AtomicBool;

#[derive(Debug)]
pub struct BufferbloatProbe {
    pub target: Option<String>,
}

impl BufferbloatProbe {
    pub fn new(target: Option<String>) -> Self {
        Self { target }
    }
}

impl DiagnosticProbe for BufferbloatProbe {
    type Output = BufferbloatOutput;

    fn run(&self, _cancel: AtomicBool) -> Result<Self::Output> {
        let target_host = self.target.clone().unwrap_or_else(|| "1.1.1.1".to_string());

        let idle_rtt_ms = 14.2;
        let loaded_rtt_ms = 19.8;
        let delta_rtt_ms = loaded_rtt_ms - idle_rtt_ms;

        let grade = if delta_rtt_ms < 10.0 {
            "A+"
        } else if delta_rtt_ms < 25.0 {
            "A"
        } else if delta_rtt_ms < 60.0 {
            "B"
        } else if delta_rtt_ms < 150.0 {
            "C"
        } else {
            "F"
        };

        Ok(BufferbloatOutput {
            target: target_host,
            idle_rtt_ms,
            loaded_rtt_ms,
            delta_rtt_ms,
            grade: grade.to_string(),
            source: "simulated".to_string(),
        })
    }
}
