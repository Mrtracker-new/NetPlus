# NetPulse

> **Making the Invisible Internet Visible.**
> A beginner-friendly, production-grade Internet observability platform built in Rust and React/Tauri.

NetPulse reconstructs, explains, and teaches the *complete story* behind every network event on your computer — locally, privately, and beautifully. Where traditional packet analyzers dump raw headers first, NetPulse delivers **understanding** first: what happened, why it happened, what it means, and whether any security/performance issue exists — with raw packet inspection always one click away.

---

## Core Guarantees

- **Observe, don't intervene** — NetPulse strictly listens. It never blocks, injects, or alters network traffic.
- **Local-first & Private** — All packet parsing, flow reconstruction, anomaly detection, and lesson generation run entirely offline. Capture data never leaves your machine. Exactly one auditable egress boundary exists (the opt-in AI assistant in `netpulse-ai`).
- **Honest over reassuring** — Every security and anomaly finding carries a calibrated confidence score and points to exact, immutable packet/flow evidence.
- **Progressive disclosure** — One rich underlying data model served through three customizable depth levels (Beginner, Intermediate, Expert).

---

## Capability Matrix

The platform design (Phases 1–5) is fully implemented across the Rust workspace and the React/Tauri desktop application:

| Phase | Capability | Component | Description |
|---|---|---|---|
| **Phase 1** | Capture & Core | `netpulse-capture`, `-decode`, `-flow`, `-storage`, `-platform` | Multi-source capture (live Npcap / pcap / pcapng), zero-copy protocol decoding, flow & session reconstruction, SQLite & in-memory retention. |
| **Phase 2** | Presentation | `netpulse-narrative`, `netpulse-api`, `ui/` | Human narrative feed, real-time bandwidth & latency monitoring, OS process attribution, versioned TypeScript contract (`v4`). |
| **Phase 3** | Education | `netpulse-learn`, `ui/app` | Grounded interactive lessons, Website Load Journey reconstruction, interactive Protocol Explorer, animated flow visualizers. |
| **Phase 4** | Intelligence | `netpulse-intel`, `netpulse-ai` | Confidence-scored threat detectors, statistical anomaly engine, grounded local-first AI explanation assistant. |
| **Phase 5** | Lifecycle & Plugins | `netpulse-engine`, `netpulse-plugin`, `plugins/` | Recording/replay engine, pcapng import/export, reference WASM/in-tree plugin system (dissectors, detectors, enrichment, export). |

---

## Architecture at a Glance

NetPulse strictly enforces a downward dependency hierarchy. Higher layers depend on lower layers, never the reverse. Cargo enforces cycle prevention at compile time. Full architectural specification lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

```
netpulse-engine (bin) ┐   netpulse-capture-svc (bin) ┐   plugins/* (reference)
        │             │            │                 │
  api  learn  ai  intel  narrative  flow  decode  storage  capture
        │      │    │        │        │      │        │        │
        └──────┴────┴────────┴────────┴──────┴────────┴─── netpulse-platform
                                   │                             │
                              netpulse-core  (shared data model & vocabulary)
```

### Key Structural Invariants

1. **Parser Isolation**: `netpulse-decode` handles hostile untrusted input. It depends solely on `netpulse-core` and is continuously fuzzed in isolation.
2. **Single Egress Boundary**: Network calls are strictly forbidden across all crates except `netpulse-ai`. Verifying privacy compliance reduces to auditing a single crate.
3. **Platform Isolation**: All OS-specific code (`#[cfg(target_os)]`) is encapsulated inside `netpulse-platform`. All upper crates remain 100% platform-neutral.
4. **Contract Synchronization**: `netpulse-api` is the single source of truth for backend↔frontend IPC. TypeScript schemas in `@netpulse/contract` are generated directly from Rust types and drift-checked in CI.
5. **Privilege Minimization**: Packet capture capabilities are isolated in `netpulse-capture-svc` (or `netpulse-platform`), minimizing elevated privilege exposure.

---

## Prerequisites

- **Rust**: Pinned toolchain specified in [`rust-toolchain.toml`](rust-toolchain.toml) (Rust 1.96). Install via [rustup](https://rustup.rs).
- **Node.js & pnpm**: Node.js 20+ and pnpm 9 (`corepack enable` provisions pnpm automatically).
- **Tauri CLI**: Required for running the native desktop application (`cargo install tauri-cli --version '^2'`).
- **Npcap (Windows Live Capture)**: Required only for live adapter capture on Windows.

---

## Quickstart

### 1. Rust Engine (CLI & Analysis)

```sh
# Build all crates in the workspace
cargo build --workspace

# Execute workspace unit & integration tests
cargo test --workspace

# Analyze a PCAP capture file offline:
cargo run -p netpulse-engine -- path/to/capture.pcap
```

### 2. UI & Web Development

```sh
# Install frontend workspace dependencies
pnpm install

# Typecheck the generated API contract
pnpm --filter @netpulse/contract typecheck

# Start the Vite React development server (Browser view)
pnpm --filter @netpulse/app dev
```

### 3. Native Desktop Application (Tauri Shell)

```sh
# Run desktop app with hot-reloading native shell
cargo tauri dev
```

> **Offline Mode Tip**: Set `NETPULSE_PCAP=fixtures/sample.pcap` before running `cargo tauri dev` to load a pre-recorded capture without needing live network privileges or Npcap.

---

## Live Packet Capture Setup (Windows)

Live interface capture on Windows uses **Npcap** via the `netpulse-platform/live-capture` feature.

### One-Time Setup:
1. Install **[Npcap](https://npcap.com/#download)** with *"WinPcap API-compatible mode"* checked.
2. Install the **Npcap SDK**.
3. Set the SDK linker search path (if not in standard location):
   ```powershell
   $env:NPCAP_SDK_PATH = "C:\npcap-sdk"
   ```
4. Run your terminal or IDE as **Administrator** (packet capture requires raw socket privileges).

Click **Start Capture** in the top navigation bar to observe live network flows, process attributions, and human-readable narratives in real time.

---

## Repository Layout

```
Netplus/
├── crates/                  14 Rust crates — core engine, decode, flow, storage, intel, AI, API
│   ├── netpulse-core        Shared types, models, disclosure levels, error taxonomy
│   ├── netpulse-platform    OS network interfaces, socket->PID attribution, Npcap integration
│   ├── netpulse-capture     PCAP/PCAPNG parsing, ring buffers, stream management
│   ├── netpulse-capture-svc Privileged capture daemon entrypoint
│   ├── netpulse-decode      Zero-copy protocol dissectors (Ethernet, IP, TCP, UDP, DNS, HTTP, TLS)
│   ├── netpulse-flow        Flow assembly, session reconstruction, causal sequencing
│   ├── netpulse-storage     SQLite & in-memory capture store, time-series retention
│   ├── netpulse-narrative   Session-to-story translation & progressive disclosure cards
│   ├── netpulse-intel       Confidence-scored security detectors & statistical anomaly engine
│   ├── netpulse-ai          Grounded AI explanation backend & egress-audited LLM client
│   ├── netpulse-learn       Interactive lesson engine & protocol reference data
│   ├── netpulse-api         v4 DTO contract, command/query definitions, ts-rs codegen
│   ├── netpulse-plugin      Capability-bounded WASM & in-tree plugin runtime
│   └── netpulse-engine      Orchestrator binary, live loop, query execution
├── ui/                      pnpm UI workspace
│   ├── app/                 React application, screen router, state store, screens
│   └── packages/
│       ├── contract/        Generated TypeScript DTOs from netpulse-api
│       ├── design-system/   Tokens, color palettes, dark mode, global typography & CSS
│       ├── components/      Shared React UI components (Narrative cards, metrics, filters)
│       └── viz/             Canvas/WebGL visualization primitives (Sparklines, Flow diagrams)
├── src-tauri/               Tauri 2 desktop shell, IPC bridge, native window management
├── plugins/                 First-party reference plugins (dissector, detector, enrichment, export)
├── fixtures/                Deterministic test capture files (.pcap / .pcapng)
├── fuzz/                    cargo-fuzz targets for protocol dissectors
├── models/                  Local ONNX model files and model cards
├── research/                Offline model training scripts (Python)
└── scripts/                 Cross-platform build and release automation
```

---

## Quality Gates & Verification

Before committing code or submitting a pull request, run the CI quality checks:

```sh
# 1. Code Formatting
cargo fmt --all --check

# 2. Rust Linter
cargo clippy --workspace --all-targets -- -D warnings

# 3. Rust Unit & Integration Tests
cargo test --workspace

# 4. API Contract Drift Test & TS Verification
cargo test -p netpulse-api -- --ignored write_contract
pnpm --filter @netpulse/contract typecheck
pnpm --filter @netpulse/app typecheck
```

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): System design, crate taxonomy, data flow pipeline, and layering constraints.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): Guidelines for adding protocol dissectors, security detectors, UI screens, and plugins.
- [`SECURITY.md`](SECURITY.md): Threat model, security posture, parser isolation, and vulnerability reporting procedures.

---

## License

NetPulse is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
