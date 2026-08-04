//! Fuzz regression test suite replaying committed corpus seeds and running
//! deterministic PRNG boundary-length fuzzing during standard `cargo test`.

use std::fs;
use std::path::PathBuf;

use netpulse_decode::layers::{ethernet, ipv4, ipv6, tcp, udp};
use netpulse_decode::{decode_frame, dns, http, tls, LinkType, Reader};

/// Simple deterministic linear congruential generator (LCG) PRNG to avoid external dependencies.
struct SeededPrng {
    state: u64,
}

impl SeededPrng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.state >> 32) as u32
    }

    fn fill_bytes(&mut self, buf: &mut [u8]) {
        for chunk in buf.chunks_mut(4) {
            let val = self.next_u32().to_le_bytes();
            for (slot, &byte) in chunk.iter_mut().zip(val.iter()) {
                *slot = byte;
            }
        }
    }
}

/// Find workspace root directory.
fn workspace_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if dir.ends_with("crates/netpulse-decode") || dir.ends_with("crates\\netpulse-decode") {
        dir.pop();
        dir.pop();
    }
    dir
}

/// Replay a single corpus sample byte slice against all dissector entry points.
fn replay_sample(bytes: &[u8]) {
    // Top-level decode pipeline
    let _ = decode_frame(LinkType::Ethernet, bytes);
    let _ = decode_frame(LinkType::Loopback, bytes);
    let _ = decode_frame(LinkType::RawIp, bytes);

    // Individual layer parsers
    let mut r1 = Reader::new(bytes);
    let _ = ethernet(&mut r1);

    let mut r2 = Reader::new(bytes);
    let _ = ipv4(&mut r2);

    let mut r3 = Reader::new(bytes);
    let _ = ipv6(&mut r3);

    let mut r4 = Reader::new(bytes);
    let _ = tcp(&mut r4);

    let mut r5 = Reader::new(bytes);
    let _ = udp(&mut r5);

    // L7 dissectors
    let _ = dns::dissect(bytes);
    let _ = http::dissect(bytes);
    let _ = tls::dissect(bytes);
}

#[test]
fn test_replay_committed_corpus_seeds() {
    let root = workspace_root();
    let corpus_dir = root.join("fuzz").join("corpus");

    if !corpus_dir.exists() {
        return;
    }

    let targets = [
        "decode_frame",
        "ethernet",
        "ipv4",
        "ipv6",
        "tcp",
        "udp",
        "dns",
        "http",
        "tls",
    ];

    let mut sample_count = 0;
    for target in targets {
        let target_dir = corpus_dir.join(target);
        if let Ok(entries) = fs::read_dir(target_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Ok(bytes) = fs::read(&path) {
                        replay_sample(&bytes);
                        sample_count += 1;
                    }
                }
            }
        }
    }

    assert!(sample_count > 0, "Expected at least 1 committed corpus seed file to be replayed");
}

#[test]
fn test_deterministic_boundary_length_fuzzing() {
    let boundary_sizes = [
        0, 1, 2, 3, 4, 5, 7, 8, 13, 20, 40, 60, 64, 127, 128, 255, 256, 511, 512, 1023, 1024, 1499,
        1500, 4096, 65535,
    ];

    let mut prng = SeededPrng::new(0xDEADBEEF_CAFEBABE);

    for &size in &boundary_sizes {
        for _iteration in 0..50 {
            let mut buf = vec![0u8; size];
            prng.fill_bytes(&mut buf);
            replay_sample(&buf);
        }
    }
}
