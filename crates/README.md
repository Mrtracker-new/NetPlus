# NetPulse Workspace Crates (`crates/`)

The core NetPulse backend is structured as a Rust workspace comprising 14 decoupled crates. Each crate occupies a specific layer in the system hierarchy and enforces strict architectural invariants.

---

## Workspace Crate Matrix

**Status Legend**: ✅ Complete | 🚧 In Progress | 📋 Planned | Single Source of Truth: [`../docs/status.yml`](../docs/status.yml)

| Crate Name | Layer | Design | Code | Runtime | Purpose & Key Responsibilities |
|---|---|:---:|:---:|:---:|---|
| [`netpulse-core`](netpulse-core/) | Base | ✅ Complete | ✅ Complete | ✅ Complete | Shared data models (`Flow`, `Session`, `Finding`, `Packet`), error types, progressive disclosure levels (*Beginner*, *Intermediate*, *Expert*), and common traits. |
| [`netpulse-platform`](netpulse-platform/) | Platform | ✅ Complete | 🚧 In Progress | 🚧 In Progress | OS-specific abstraction layer (Windows Npcap bindings, network interface enumeration, process attribution via `GetExtendedTcpTable`). |
| [`netpulse-capture`](netpulse-capture/) | Ingest | ✅ Complete | ✅ Complete | 🚧 In Progress | Capture source traits (`PcapSource`, `LiveSource`), PCAP/PCAPNG file readers/writers, bounded ring buffer, shedding policy, recording & replay. |
| [`netpulse-capture-svc`](netpulse-capture-svc/) | Daemon | ✅ Complete | 🚧 In Progress | 📋 Planned | Standalone, privileged capture daemon binary scaffold for privilege-separated packet acquisition. |
| [`netpulse-decode`](netpulse-decode/) | Decode | ✅ Complete | ✅ Complete | 🚧 In Progress | Zero-copy protocol dissection engine (Ethernet, ARP, IPv4, IPv6, TCP, UDP, ICMP, DNS, HTTP/1.1, TLS). Fuzzed in isolation (`fuzz/`). |
| [`netpulse-flow`](netpulse-flow/) | Assembly | ✅ Complete | ✅ Complete | ✅ Complete | Bi-directional flow state machine, 5-tuple tracking, session synthesis, causal event ordering, and connection metrics. |
| [`netpulse-storage`](netpulse-storage/) | Persistence | ✅ Complete | ✅ Complete | 🚧 In Progress | Thread-safe `CaptureStore` (in-memory complete, durable SQLite persistence backend planned), time-series rollups, and metadata policies. |
| [`netpulse-narrative`](netpulse-narrative/) | Presentation | ✅ Complete | ✅ Complete | ✅ Complete | Story projection engine mapping raw network flows and sessions into human-understandable narrative cards. |
| [`netpulse-intel`](netpulse-intel/) | Intelligence | ✅ Complete | ✅ Complete | ✅ Complete | Rules-based threat detectors (DNS tunneling, port scans) and statistical anomaly engine with calibrated confidence scoring. |
| [`netpulse-ai`](netpulse-ai/) | AI Engine | ✅ Complete | ✅ Complete | 🚧 In Progress | Grounded context retriever, citation validator, and `LocalTemplateBackend` complete. Local ONNX LLM backend planned. **Holds sole egress capability.** |
| [`netpulse-learn`](netpulse-learn/) | Education | ✅ Complete | ✅ Complete | ✅ Complete | Interactive curriculum engine, Website Load Journey synthesizer, and Protocol Explorer reference content. |
| [`netpulse-api`](netpulse-api/) | API | ✅ Complete | ✅ Complete | ✅ Complete | Versioned IPC contract (`v4`), Query/Command/Stream DTOs, and automated TypeScript codegen for `@netpulse/contract`. |
| [`netpulse-plugin`](netpulse-plugin/) | Extensibility | ✅ Complete | ✅ Complete | 🚧 In Progress | Extension seam traits (`Dissector`, `Detector`, `Enrichment`, `ExportPlugin`, `ViewPlugin`), capability model, Ed25519 verifier, registry complete; WASM host planned. |
| [`netpulse-engine`](netpulse-engine/) | Orchestrator | ✅ Complete | ✅ Complete | 🚧 In Progress | Main engine binary, offline PCAP file pipeline complete. Live capture execution loop and stream dispatcher in progress. |

---

## Architectural Invariants

1. **Strict Downward Hierarchy**: Dependency arrows point strictly downward. Higher layers may depend on lower layers, but never the reverse. Cargo prevents cycles at compile time.
2. **Parser Isolation**: All raw packet bytes from untrusted network sources are dissected inside `netpulse-decode`. It depends only on `netpulse-core` and forbids unsafe memory operations.
3. **Single Egress Boundary**: Network egress is forbidden across all crates except `netpulse-ai`.
4. **Platform Encapsulation**: OS-specific code (`#[cfg(target_os)]`) lives exclusively in `netpulse-platform`.
