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

| Crate Name | Layer | Purpose & Responsibility |
|---|---|---|
| [`netpulse-core`](crates/netpulse-core) | Base | Core data types (`Flow`, `Session`, `Finding`, `Packet`), error taxonomy, progressive disclosure levels (`Beginner`, `Intermediate`, `Expert`), and shared traits. |
| [`netpulse-platform`](crates/netpulse-platform) | Platform | OS-specific network interface enumeration, process attribution (`GetExtendedTcpTable` / `/proc/net`), and Windows Npcap bindings. |
| [`netpulse-capture`](crates/netpulse-capture) | Ingest | Capture source abstractions (`PcapSource`, `LiveSource`), pcap/pcapng file readers/writers, bounded ring buffer, and packet shedding policy. |
| [`netpulse-capture-svc`](crates/netpulse-capture-svc) | Daemon | Standalone, privileged capture daemon binary and IPC transport. |
| [`netpulse-decode`](crates/netpulse-decode) | Decode | Fast, zero-copy protocol dissectors (Ethernet, ARP, IPv4, IPv6, TCP, UDP, ICMP, DNS, HTTP/1.1, TLS). Fuzzed in isolation. |
| [`netpulse-flow`](crates/netpulse-flow) | Assembly | Bi-directional flow state machine, 5-tuple tracking, session synthesis, causal event ordering, and connection metrics. |
| [`netpulse-storage`](crates/netpulse-storage) | Persistence | Thread-safe, SQLite-backed or in-memory `CaptureStore`, windowed queries, and time-series rollups. Enforces metadata-only retention policies. |
| [`netpulse-narrative`](crates/netpulse-narrative) | Presentation | Session-to-story translation engine. Maps raw network events into human-understandable narrative cards across disclosure levels. |
| [`netpulse-intel`](crates/netpulse-intel) | Intelligence | Security finding detectors (e.g., DNS tunneling, port scanning, plain-text credentials) and statistical anomaly engines with calibrated confidence scores. |
| [`netpulse-ai`](crates/netpulse-ai) | AI Engine | Context retriever, prompt constructor, citation validator, and local/remote LLM backend interface. Holds the sole egress capability. |
| [`netpulse-learn`](crates/netpulse-learn) | Education | Interactive curriculum engine, Website Load Journey synthesizer, and Protocol Explorer reference content. |
| [`netpulse-api`](crates/netpulse-api) | API | Versioned IPC DTO contract (`v4`), Query/Command definitions, stream message schemas, and TypeScript codegen. |
| [`netpulse-plugin`](crates/netpulse-plugin) | Extensibility | Plugin host, capability checking, signature verification, and reference plugin interfaces (dissectors, detectors, enrichment, views, export). |
| [`netpulse-engine`](crates/netpulse-engine) | Orchestrator | Main engine binary, live capture execution loop, pipeline assembly, and query execution. |

---

## 5. UI Architecture & Package Hierarchy

The UI is managed as a pnpm workspace under `ui/`:

- **`@netpulse/contract`** (`ui/packages/contract`): Generated TypeScript types matching `netpulse-api` Rust structs.
- **`@netpulse/design-system`** (`ui/packages/design-system`): CSS design tokens, typography, dark mode palettes, protocol iconography, and severity styling.
- **`@netpulse/components`** (`ui/packages/components`): Reusable, disclosure-aware UI components (cards, headers, filters, detail drawers).
- **`@netpulse/viz`** (`ui/packages/viz`): WebGL and Canvas visualization primitives (Sparklines, Donut charts, Flow diagrams, Confidence meters).
- **`@netpulse/app`** (`ui/app`): Main React 18 single-page application hosting screens (`Dashboard`, `Timeline`, `Security`, `Apps`, `Learn`, `Explorer`, `Plugins`).
