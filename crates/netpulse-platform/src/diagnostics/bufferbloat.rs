//! Authentic Dual-Phase Bufferbloat Latency & Congestion Diagnostic Probe.
//!
//! Measures baseline idle RTT against the target, initiates a bounded saturating
//! HTTP download stream to congest the network link, measures latency under load,
//! and computes the delta latency to assign an authentic bufferbloat grade.

use super::models::BufferbloatOutput;
use super::ping::{ping_target, resolve_target_ipv4};
use super::DiagnosticProbe;
use netpulse_core::Result;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const DEFAULT_SATURATION_URL: &str = "http://speed.cloudflare.com/__down?bytes=50000000";
const DEFAULT_DURATION_SECS: u64 = 3;

#[derive(Debug, Clone)]
pub struct BufferbloatProbe {
    pub target: Option<String>,
    pub download_url: Option<String>,
    pub duration_secs: Option<u64>,
}

impl BufferbloatProbe {
    pub fn new(target: Option<String>) -> Self {
        Self {
            target,
            download_url: None,
            duration_secs: None,
        }
    }

    pub fn with_download_url(target: Option<String>, download_url: Option<String>) -> Self {
        Self {
            target,
            download_url,
            duration_secs: None,
        }
    }

    pub fn with_options(
        target: Option<String>,
        download_url: Option<String>,
        duration_secs: Option<u64>,
    ) -> Self {
        Self {
            target,
            download_url,
            duration_secs,
        }
    }

    pub fn run_with_cancel(&self, cancel: Arc<AtomicBool>) -> Result<BufferbloatOutput> {
        let target_host = self
            .target
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("1.1.1.1")
            .to_string();

        if cancel.load(Ordering::Relaxed) {
            return Ok(BufferbloatOutput {
                target: target_host,
                idle_rtt_ms: 0.0,
                loaded_rtt_ms: 0.0,
                delta_rtt_ms: 0.0,
                grade: "A+".to_string(),
                source: "live".to_string(),
            });
        }

        let Some(dest_ip) = resolve_target_ipv4(&target_host) else {
            return Ok(BufferbloatOutput {
                target: target_host,
                idle_rtt_ms: 0.0,
                loaded_rtt_ms: 0.0,
                delta_rtt_ms: 0.0,
                grade: "F".to_string(),
                source: "live".to_string(),
            });
        };

        // Phase 1: Baseline Idle Latency (3 samples)
        let (_, idle_samples) = ping_target(dest_ip, 3, &cancel);
        if cancel.load(Ordering::Relaxed) {
            return Ok(BufferbloatOutput {
                target: target_host,
                idle_rtt_ms: 0.0,
                loaded_rtt_ms: 0.0,
                delta_rtt_ms: 0.0,
                grade: "A+".to_string(),
                source: "live".to_string(),
            });
        }

        let idle_rtt_ms = if idle_samples.is_empty() {
            0.0
        } else {
            round2(idle_samples.iter().sum::<f32>() / idle_samples.len() as f32)
        };

        // If target host did not respond to any idle pings, network or host is unreachable
        if idle_rtt_ms == 0.0 {
            return Ok(BufferbloatOutput {
                target: target_host,
                idle_rtt_ms: 0.0,
                loaded_rtt_ms: 0.0,
                delta_rtt_ms: 0.0,
                grade: "F".to_string(),
                source: "live".to_string(),
            });
        }

        // Phase 2: Determine Saturation Download Endpoint
        let download_url = self
            .download_url
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                if target_host.starts_with("http://") || target_host.starts_with("https://") {
                    Some(target_host.clone())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| DEFAULT_SATURATION_URL.to_string());

        let (host, port, path) = parse_url_endpoint(&download_url);
        let duration_secs = self.duration_secs.unwrap_or(DEFAULT_DURATION_SECS);
        let total_duration = Duration::from_secs(duration_secs);

        // Phase 3: Initiate Bounded Saturation Traffic & Latency Measurement Under Load
        let stop_saturation = Arc::new(AtomicBool::new(false));
        let stream_started = Arc::new(AtomicBool::new(false));

        let worker = {
            let host = host.clone();
            let path = path.clone();
            let stop = stop_saturation.clone();
            let cancel = cancel.clone();
            let started = stream_started.clone();
            std::thread::Builder::new()
                .name("bufferbloat-saturation".to_string())
                .spawn(move || {
                    run_saturation_stream(host, port, path, stop, cancel, started);
                })
        };

        let saturation_start = Instant::now();

        // Brief warm-up for saturation traffic to ramp up
        let ramp_start = Instant::now();
        while ramp_start.elapsed() < Duration::from_millis(350) && !cancel.load(Ordering::Relaxed) {
            if stream_started.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }

        // Sample latency under load (3 samples distributed evenly across the saturation window)
        let mut loaded_samples = Vec::with_capacity(3);
        let sample_interval = total_duration.saturating_sub(ramp_start.elapsed()) / 3;

        for i in 0..3 {
            if cancel.load(Ordering::Relaxed) || saturation_start.elapsed() >= total_duration {
                break;
            }

            let (_, sample) = ping_target(dest_ip, 1, &cancel);
            loaded_samples.extend(sample);

            if i + 1 < 3 && !cancel.load(Ordering::Relaxed) {
                let target_time = saturation_start + sample_interval * (i as u32 + 1);
                let now = Instant::now();
                if target_time > now {
                    sleep_interruptible(target_time - now, &cancel);
                }
            }
        }

        // Wait for remaining bounded duration to cleanly finish saturation window
        if !cancel.load(Ordering::Relaxed) {
            let elapsed = saturation_start.elapsed();
            if elapsed < total_duration {
                sleep_interruptible(total_duration - elapsed, &cancel);
            }
        }

        // Cleanly stop saturation traffic and join worker thread
        stop_saturation.store(true, Ordering::Relaxed);
        if let Ok(handle) = worker {
            let _ = handle.join();
        }

        if cancel.load(Ordering::Relaxed) {
            return Ok(BufferbloatOutput {
                target: target_host,
                idle_rtt_ms,
                loaded_rtt_ms: 0.0,
                delta_rtt_ms: 0.0,
                grade: "A+".to_string(),
                source: "live".to_string(),
            });
        }

        let loaded_rtt_ms = if loaded_samples.is_empty() {
            // Target was responsive at idle but dropped all packets under saturation load
            round2(idle_rtt_ms + 250.0)
        } else {
            round2(loaded_samples.iter().sum::<f32>() / loaded_samples.len() as f32)
        };

        let delta_rtt_ms = round2((loaded_rtt_ms - idle_rtt_ms).max(0.0));
        let grade = calculate_grade(delta_rtt_ms, true);

        Ok(BufferbloatOutput {
            target: target_host,
            idle_rtt_ms,
            loaded_rtt_ms,
            delta_rtt_ms,
            grade: grade.to_string(),
            source: "live".to_string(),
        })
    }
}

pub(crate) fn parse_url_endpoint(url: &str) -> (String, u16, String) {
    let raw = url.trim();
    let (host_port, path) = if let Some(idx) = raw.find("://") {
        let rest = &raw[idx + 3..];
        if let Some(slash_idx) = rest.find('/') {
            (&rest[..slash_idx], &rest[slash_idx..])
        } else {
            (rest, "/")
        }
    } else if let Some(slash_idx) = raw.find('/') {
        (&raw[..slash_idx], &raw[slash_idx..])
    } else {
        (raw, "/")
    };

    let (host, port) = if host_port.starts_with('[') {
        if let Some(bracket_end) = host_port.find(']') {
            let h = &host_port[1..bracket_end];
            let after = &host_port[bracket_end + 1..];
            let p = if let Some(colon_idx) = after.find(':') {
                after[colon_idx + 1..].parse::<u16>().unwrap_or(80)
            } else {
                80
            };
            (h, p)
        } else {
            (host_port, 80)
        }
    } else if let Some(colon_idx) = host_port.rfind(':') {
        let maybe_port = &host_port[colon_idx + 1..];
        if let Ok(p) = maybe_port.parse::<u16>() {
            if !host_port[..colon_idx].contains(':') {
                (&host_port[..colon_idx], p)
            } else {
                (host_port, 80)
            }
        } else {
            (host_port, 80)
        }
    } else {
        (host_port, 80)
    };

    (host.to_string(), port, path.to_string())
}

fn round2(v: f32) -> f32 {
    let r = (v * 100.0).round() / 100.0;
    if v > 0.0 && r == 0.0 {
        0.01
    } else {
        r
    }
}

pub(crate) fn calculate_grade(delta_rtt_ms: f32, reachable: bool) -> &'static str {
    if !reachable {
        "F"
    } else if delta_rtt_ms < 10.0 {
        "A+"
    } else if delta_rtt_ms < 25.0 {
        "A"
    } else if delta_rtt_ms < 60.0 {
        "B"
    } else if delta_rtt_ms < 150.0 {
        "C"
    } else {
        "F"
    }
}

/// Helper function to perform interruptible sleep checking cancellation every 25ms.
fn sleep_interruptible(duration: Duration, cancel: &AtomicBool) {
    let start = Instant::now();
    while start.elapsed() < duration && !cancel.load(Ordering::Relaxed) {
        let remaining = duration.saturating_sub(start.elapsed());
        let step = Duration::from_millis(25).min(remaining);
        std::thread::sleep(step);
    }
}

fn run_saturation_stream(
    host: String,
    port: u16,
    path: String,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    stream_started: Arc<AtomicBool>,
) {
    let Ok(addrs) = (&host[..], port).to_socket_addrs() else {
        return;
    };
    let Some(addr) = addrs.into_iter().next() else {
        return;
    };

    let host_header = if port == 80 {
        host.clone()
    } else {
        format!("{host}:{port}")
    };

    while !stop.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
        let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(1000)) else {
            sleep_interruptible(Duration::from_millis(50), &cancel);
            continue;
        };

        let _ = stream.set_read_timeout(Some(Duration::from_millis(100)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: NetPulse-Bufferbloat/1.0\r\nConnection: keep-alive\r\nAccept: */*\r\n\r\n"
        );

        if stream.write_all(req.as_bytes()).is_err() {
            continue;
        }

        let mut buf = [0u8; 65536];
        while !stop.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
            match stream.read(&mut buf) {
                Ok(0) => break, // EOF, chunk finished
                Ok(_) => {
                    stream_started.store(true, Ordering::Relaxed);
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    continue;
                }
                Err(_) => break,
            }
        }
    }
}

impl DiagnosticProbe for BufferbloatProbe {
    type Output = BufferbloatOutput;

    fn run(&self, cancel: Arc<AtomicBool>) -> Result<Self::Output> {
        self.run_with_cancel(cancel)
    }
}
