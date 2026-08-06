# Test Capture Fixtures (`fixtures/`)

Recorded network capture files (`.pcap` and `.pcapng`) used as deterministic inputs for integration testing, replay verification, and performance benchmarks.

---

## Directory Governance & Status

- **Architectural Status**: Reserved directory for deterministic packet capture files (`.pcap` / `.pcapng`).
- **Source Control Policy**: Git tracks this directory via `README.md`. Test captures are added when disk-based pcap files are required for integration suites.
- **Population Trigger**: Populated when adding integration test cases for protocol dissectors, capture source replay, or threat detection verification.

---

## Role in Testing & CI

Because NetPulse session reconstruction and threat detection are 100% deterministic, the entire pipeline (decoding, flow state machine, security detectors, narrative cards) is tested against fixed capture files in this directory.

This guarantees reproducible CI test execution without requiring live network interfaces or elevated privileges.

