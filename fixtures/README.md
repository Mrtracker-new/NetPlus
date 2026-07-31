# Test Capture Fixtures (`fixtures/`)

Recorded network capture files (`.pcap` and `.pcapng`) used as deterministic inputs for integration testing, replay verification, and performance benchmarks.

---

## Role in Testing & CI

Because NetPulse session reconstruction and threat detection are 100% deterministic, the entire pipeline (decoding, flow state machine, security detectors, narrative cards) is tested against fixed capture files in this directory.

This guarantees reproducible CI test execution without requiring live network interfaces or elevated privileges.
