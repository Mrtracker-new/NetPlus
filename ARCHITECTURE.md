# NetPulse Architecture & System Design

This document details the architectural principles, component taxonomy, data flow pipelines, and isolation boundaries governing NetPulse.

---

## 1. Architectural Principles & Invariants

NetPulse is designed around five strict architectural invariants:

1. **Strict Downward Dependency Hierarchy**: The crate dependency graph is the system layer diagram. Arrows point strictly downward — higher layers may depend on lower layers, but never the reverse. Cargo enforces this rule at compile time.
2. **Parser Isolation**: Untrusted, potentially malicious bytes from raw network packets are parsed exclusively inside `netpulse-decode`. This crate depends solely on `netpulse-core` and is isolated and fuzzed (`fuzz/`).
3. **Single Auditable Egress Boundary**: Mandatory network egress is forbidden across the entire backend. Only `netpulse-ai` is permitted to open outbound sockets (when explicit remote LLM integration is enabled by the user).
4. **Platform Isolation**: All OS-specific APIs (`#[cfg(target_os)]`), such as Windows Npcap, Linux AF_PACKET, or macOS BPF, are encapsulated within `netpulse-platform`. All higher layers remain platform-agnostic.
5. **Versioned API Contract**: `netpulse-api` (v4 contract) defines the sole backend↔frontend boundary. TypeScript interfaces in `@netpulse/contract` are generated from Rust structs and drift-checked in CI.

---

## 2. Process & Execution Model

NetPulse divides responsibilities across distinct processes to maintain privilege isolation and system stability:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Desktop User UI                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Vite + React Application                       │  │
│  │     (@netpulse/app, @netpulse/components, @netpulse/viz)         │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    │ IPC (Tauri v2 invoke / events)     │
│  ┌─────────────────────────────────▼─────────────────────────────────┐  │
│  │                    Tauri Desktop Shell (`src-tauri`)               │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │ Query / Command (netpulse-api v4)
┌────────────────────────────────────▼────────────────────────────────────┐
│                        Engine Process (`netpulse-engine`)               │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────┐  │
│  │  narrative   │   │    intel     │   │    learn     │   │    ai    │  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └────┬─────┘  │
│         └──────────────────┼──────────────────┘                │        │
│                            ▼                                   │        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │        │
│  │    storage   │◀──│     flow     │◀──│    decode    │        │        │
│  └──────────────┘   └──────────────┘   └──────┬───────┘        │        │
│                            ▲                  │                │        │
└────────────────────────────┼──────────────────┼────────────────┼────────┘
                             │                  │                │
┌────────────────────────────┼──────────────────┼────────────────┼────────┐
│  Privileged Capture        │                  │                │        │
│  Service (optional)        │                  │                ▼        │
│  ┌─────────────────────────┴─────────┐        │       ┌─────────────────┤
│  │  `netpulse-capture-svc` (bin)     │        │       │  Opt-in Egress  │
│  │  or `netpulse-platform` (Npcap)   │        │       │  AI Assistant   │
│  └───────────────────────────────────┘        │       └─────────────────┘
└───────────────────────────────────────────────┼─────────────────────────┘
                                                ▼
                                    Raw Network Interfaces / PCAP
```

- **`netpulse-engine` (Binary)**: Runs at standard user privileges. Executes packet decoding, flow/session reconstruction, intelligence detection, narrative generation, persistent storage, and serves the Query/Stream API.
- **`netpulse-capture-svc` (Binary)**: Deliberately minimal, privileged daemon holding raw packet capture capabilities (e.g., Administrator / `CAP_NET_RAW`). Streams raw frames to the engine over IPC.
- **Tauri Desktop Shell (`src-tauri`)**: Hosts the native OS window and React webview. Translates webview IPC calls into engine queries and streams live capture events. Maintains an independent Cargo dependency graph (`src-tauri/Cargo.lock`) excluded from workspace compilation to keep pure-Rust CI jobs fast and webview-free, while receiving identical security governance (Dependabot, `cargo audit`, `cargo deny`).

---

## 3. Data Flow Pipeline

```
Raw Frame (Ethernet/802.11)
  │
  ▼
[netpulse-capture / netpulse-platform]
  │ Ingest & Buffer (bounded ring buffer)
  ▼
[netpulse-decode]
  │ Zero-Copy Dissection (Ethernet → IPv4/v6 → TCP/UDP → DNS/HTTP/TLS)
  ▼
[netpulse-flow]
  │ Flow Aggregation (5-tuple grouping, metrics, state machines)
  │ Session Reconstruction (Causal linking, HTTP transactions, TLS handshakes)
  ▼
[netpulse-storage]
  │ Metadata & Time-Series Persistence (SQLite / In-Memory CaptureStore)
  ▼
┌───────────────────────────┬───────────────────────────┬───────────────────────────┐
│                           │                           │                           │
▼                           ▼                           ▼                           ▼
[netpulse-narrative]       [netpulse-intel]            [netpulse-learn]            [netpulse-ai]
Human story projection     Security & anomaly rules    Interactive lessons &       Grounded query answers
Progressive cards          Confidence scoring          protocol explorer           (Opt-in egress boundary)
│                           │                           │                           │
└───────────────────────────┴─────────────┬─────────────┴───────────────────────────┘
                                          │
                                          ▼
                                   [netpulse-api]
                                   v4 DTO Serialization
                                          │
                                          ▼
                                   [@netpulse/contract]
                                   TypeScript Types
                                          │
                                          ▼
                                   [UI Screens]
                                   Dashboard, Timeline, Security, Apps, Learn
```

---

## 4. Crate Taxonomy & Responsibility Matrix

**Status Legend**: ✅ Complete | 🚧 In Progress | 📋 Planned | Single Source of Truth: [`docs/status.yml`](docs/status.yml)

| Crate Name | Layer | Design | Code | Runtime | Purpose & Responsibility |
|---|---|:---:|:---:|:---:|---|
| [`netpulse-core`](crates/netpulse-core) | Base | ✅ Complete | ✅ Complete | ✅ Complete | Shared data models (`Flow`, `Session`, `Finding`, `Packet`), error taxonomy, progressive disclosure levels (`Beginner`, `Intermediate`, `Expert`), and core traits. |
| [`netpulse-platform`](crates/netpulse-platform) | Platform | ✅ Complete | 🚧 In Progress | 🚧 In Progress | OS-specific network interface enumeration, process attribution (`GetExtendedTcpTable`), and Windows Npcap bindings (behind `live-capture` feature gate). |
| [`netpulse-capture`](crates/netpulse-capture) | Ingest | ✅ Complete | ✅ Complete | 🚧 In Progress | Capture source abstractions (`PcapSource`, `LiveSource`), PCAP/PCAPNG file readers/writers, bounded ring buffer, shedding policy, recording & replay. |
| [`netpulse-capture-svc`](crates/netpulse-capture-svc) | Daemon | ✅ Complete | 🚧 In Progress | 📋 Planned | Standalone privileged capture daemon binary scaffold and IPC frame-handoff transport. |
| [`netpulse-decode`](crates/netpulse-decode) | Decode | ✅ Complete | ✅ Complete | 🚧 In Progress | Zero-copy dissectors (Ethernet, ARP, IPv4/6, TCP, UDP, ICMP, DNS, HTTP/1.1, TLS) complete & fuzzed. QUIC/HTTP3, DHCP, mDNS planned. |
| [`netpulse-flow`](crates/netpulse-flow) | Assembly | ✅ Complete | ✅ Complete | ✅ Complete | Bi-directional flow state machine, 5-tuple tracking, session synthesis, causal event ordering, and connection metrics. |
| [`netpulse-storage`](crates/netpulse-storage) | Persistence | ✅ Complete | ✅ Complete | 🚧 In Progress | Thread-safe in-memory `CaptureStore`, windowed queries, and time-series rollups complete. Durable SQLite backend planned. |
| [`netpulse-narrative`](crates/netpulse-narrative) | Presentation | ✅ Complete | ✅ Complete | ✅ Complete | Session-to-story translation engine. Maps raw network flows and sessions into human-understandable narrative cards across disclosure levels. |
| [`netpulse-intel`](crates/netpulse-intel) | Intelligence | ✅ Complete | ✅ Complete | ✅ Complete | Rules-based threat detectors (DNS tunneling, port scans) and statistical anomaly engines with calibrated confidence scores. |
| [`netpulse-ai`](crates/netpulse-ai) | AI Engine | ✅ Complete | ✅ Complete | 🚧 In Progress | Grounded retrieval, citation validator, and `LocalTemplateBackend` complete. Local ONNX LLM backend planned. Holds sole egress capability. |
| [`netpulse-learn`](crates/netpulse-learn) | Education | ✅ Complete | ✅ Complete | ✅ Complete | Interactive curriculum engine, Website Load Journey synthesizer, and Protocol Explorer reference content. |
| [`netpulse-api`](crates/netpulse-api) | API | ✅ Complete | ✅ Complete | ✅ Complete | Versioned IPC DTO contract (`v4`), Query/Command definitions, stream message schemas, and TypeScript codegen. |
| [`netpulse-plugin`](crates/netpulse-plugin) | Extensibility | ✅ Complete | ✅ Complete | 🚧 In Progress | Plugin seam traits, capability model, Ed25519 signature verifier, registry, and config manager complete. WASM host loader planned. |
| [`netpulse-engine`](crates/netpulse-engine) | Orchestrator | ✅ Complete | ✅ Complete | 🚧 In Progress | Main engine binary, offline PCAP file pipeline complete. Live capture loop execution and streaming push events in progress. |

---

## 5. UI Architecture & Package Hierarchy

The UI is managed as a pnpm workspace under `ui/`:

- **`@netpulse/contract`** (`ui/packages/contract`): ✅ Complete | Generated TypeScript types matching `netpulse-api` Rust structs.
- **`@netpulse/design-system`** (`ui/packages/design-system`): 🚧 In Progress | CSS design tokens, typography, dark mode palettes, protocol iconography, and severity styling.
- **`@netpulse/components`** (`ui/packages/components`): 🚧 In Progress | Reusable, disclosure-aware UI components (cards, headers, filters, detail drawers).
- **`@netpulse/viz`** (`ui/packages/viz`): 🚧 In Progress | WebGL and Canvas visualization primitives (Sparklines, Donut charts, Flow diagrams, Confidence meters).
- **`@netpulse/app`** (`ui/app`): 🚧 In Progress | Main React 18 single-page application hosting screens (`Dashboard`, `Timeline`, `Security`, `Apps`, `Learn`, `Explorer`, `Plugins`).

---

## 6. Documentation Ownership & Status Governance

Documentation must strictly reflect the current implementation state of the source code.
Whenever a pull request changes the maturity status of a crate or capability (e.g. implementing live capture or SQLite storage):
1. Audit crate code and update [`docs/status.yml`](docs/status.yml).
2. Update status tables in `README.md`, `ARCHITECTURE.md`, `docs/README.md`, and `crates/README.md`.
3. Run `python scripts/verify_docs_status.py` to confirm zero drift and zero broken links before opening a PR.
