# NetPulse Workspace Crates (`crates/`)

The core NetPulse backend is structured as a Rust workspace comprising 14 decoupled crates. Each crate occupies a specific layer in the system hierarchy and enforces strict architectural invariants.

---

## Workspace Crate Matrix

| Crate Name | Layer | Purpose & Key Responsibilities |
|---|---|---|
| [`netpulse-core`](netpulse-core/) | Base | Shared data models (`Flow`, `Session`, `Finding`, `Packet`), error types, progressive disclosure levels (*Beginner*, *Intermediate*, *Expert*), and common traits. |
| [`netpulse-platform`](netpulse-platform/) | Platform | OS-specific abstraction layer (Windows Npcap bindings, network interface enumeration, process attribution via `GetExtendedTcpTable` / `/proc/net`). |
| [`netpulse-capture`](netpulse-capture/) | Ingest | Capture source traits (`PcapSource`, `LiveSource`), PCAP/PCAPNG file readers/writers, bounded ring buffer, and packet shedding policy. |
| [`netpulse-capture-svc`](netpulse-capture-svc/) | Daemon | Standalone, privileged capture daemon binary for privilege-separated packet acquisition. |
| [`netpulse-decode`](netpulse-decode/) | Decode | Zero-copy protocol dissection engine (Ethernet, ARP, IPv4, IPv6, TCP, UDP, ICMP, DNS, HTTP/1.1, TLS). Fuzzed in isolation (`fuzz/`). |
| [`netpulse-flow`](netpulse-flow/) | Assembly | Bi-directional flow state machine, 5-tuple tracking, session synthesis, causal event ordering, and connection metrics. |
| [`netpulse-storage`](netpulse-storage/) | Persistence | Thread-safe `CaptureStore` (SQLite / In-Memory), time-series rollups, and metadata-only retention policies. |
| [`netpulse-narrative`](netpulse-narrative/) | Presentation | Story projection engine mapping raw network flows and sessions into human-understandable narrative cards. |
| [`netpulse-intel`](netpulse-intel/) | Intelligence | Rules-based threat detectors (DNS tunneling, port scans) and statistical anomaly engine with calibrated confidence scoring. |
| [`netpulse-ai`](netpulse-ai/) | AI Engine | Grounded context retriever, citation validator, and local/remote LLM backend wrapper. **Holds the sole network egress capability.** |
| [`netpulse-learn`](netpulse-learn/) | Education | Interactive curriculum engine, Website Load Journey synthesizer, and Protocol Explorer reference content. |
| [`netpulse-api`](netpulse-api/) | API | Versioned IPC contract (`v4`), Query/Command/Stream DTOs, and automated TypeScript codegen for `@netpulse/contract`. |
| [`netpulse-plugin`](netpulse-plugin/) | Extensibility | Extension seam traits (`Dissector`, `Detector`, `Enrichment`, `ExportPlugin`), trust model, cryptographic signature verification, and plugin runtime. |
| [`netpulse-engine`](netpulse-engine/) | Orchestrator | Main engine binary, live capture execution loop, pipeline assembly, and query dispatcher. |

---

## Architectural Invariants

1. **Strict Downward Hierarchy**: Dependency arrows point strictly downward. Higher layers may depend on lower layers, but never the reverse. Cargo prevents cycles at compile time.
2. **Parser Isolation**: All raw packet bytes from untrusted network sources are dissected inside `netpulse-decode`. It depends only on `netpulse-core` and forbids unsafe memory operations.
3. **Single Egress Boundary**: Network egress is forbidden across all crates except `netpulse-ai`.
4. **Platform Encapsulation**: OS-specific code (`#[cfg(target_os)]`) lives exclusively in `netpulse-platform`.
