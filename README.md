# NetPulse

> **Making the Invisible Internet Visible.**
> A beginner-friendly yet professional Internet observability platform.

NetPulse reconstructs, explains, and teaches the *complete story* behind every
network event on your own computer — locally, privately, and beautifully. Where
traditional analyzers show raw packets first, NetPulse shows **understanding**
first: what happened, why, what it means, and whether anything is wrong — with
the raw packets always one click away.

- **Observe, don't intervene** — never blocks, injects, or modifies traffic.
- **Local-first** — all core function works offline; no capture data leaves the
  machine by default. There is exactly one auditable egress boundary (the
  opt-in AI assistant).
- **Honest over reassuring** — every security/anomaly finding carries a
  calibrated confidence and links to the exact evidence.
- **Understanding-first, progressive disclosure** — one rich data model, three
  default depths (Beginner / Intermediate / Expert).

---

## Status

The design suite (Phases 1–5) is implemented across the Rust workspace and the
UI. In one line, the platform now does:

| Phase | Capability | Where |
|-------|------------|-------|
| 1 | Offline capture → decode → flow/session reconstruction → private storage | `netpulse-capture` · `-decode` · `-flow` · `-storage` |
| 2 | Human narrative, live monitoring, app attribution, the versioned UI contract | `netpulse-narrative` · `netpulse-api` · `ui/` |
| 3 | Education: grounded lessons, protocol explorer, animations | `netpulse-learn` |
| 4 | Intelligence: confidence-scored security & anomaly findings, grounded AI assistant | `netpulse-intel` · `netpulse-ai` |
| 5 | Lifecycle: recording/replay, pcapng, export, and the plugin system | `netpulse-engine` · `netpulse-plugin` · `plugins/` |

The next direction beyond this is charted in [`docs/6-roadmap`](docs/6-roadmap/)
— that's *future* work, not a build phase.

---

## Architecture at a glance

The crate dependency graph **is** the layer diagram. Arrows point strictly
downward — a higher layer may depend on lower ones, never the reverse, and Cargo
refuses to compile a cycle. Full detail in [`ARCHITECTURE.md`](ARCHITECTURE.md).

```
netpulse-engine (bin) ┐   netpulse-capture-svc (bin) ┐   plugins/* (reference)
        │             │            │                 │
  api  learn  ai  intel  narrative  flow  decode  storage  capture
        │      │    │        │        │      │        │        │
        └──────┴────┴────────┴────────┴──────┴────────┴─── netpulse-platform
                                   │                             │
                             netpulse-core  (the shared vocabulary — base)
```

Four invariants the structure enforces:

- **Parser isolation** — `netpulse-decode` is the hostile-input surface; it
  depends only on `netpulse-core` and is fuzzed in isolation.
- **Single egress boundary** — only `netpulse-ai` may open outbound
  connections, so "no capture data leaves by default" is a one-crate audit.
- **Platform isolation** — all OS-specific code lives in `netpulse-platform`;
  everything above it is platform-neutral.
- **One API contract** — `netpulse-api` (currently **v4**) is the single source
  of truth for the backend↔frontend boundary; the UI's TypeScript types are
  generated from it and cannot drift.

Two processes run the product: **`netpulse-engine`** (analysis, at user
privilege, serves the Query/Stream API) and **`netpulse-capture-svc`** (holds
capture capability and nothing else — deliberately tiny).

---

## Requirements

- **Rust** — the pinned toolchain in `rust-toolchain.toml` (Rust 1.96). Install
  via [rustup](https://rustup.rs); it picks up the pin automatically.
- **Node 20+ and pnpm 9** — for the UI (`corepack enable` provides pnpm).
- **Tauri CLI** — only for running the desktop app: `cargo install tauri-cli`.

---

## Run it

### The Rust engine (backend)

```sh
cargo build --workspace          # compile every crate
cargo test  --workspace          # run all tests
cargo run   -p netpulse-engine   # prints the banner + usage

# Analyze a capture file offline (the full reconstruction pipeline):
cargo run -p netpulse-engine -- path/to/capture.pcap
# → frames read, packets decoded, flows, sessions, causal links.
# Payloads are never written to disk under the default MetadataOnly policy.
```

### The desktop app (UI)

```sh
pnpm install                              # install UI workspace deps
pnpm --filter @netpulse/app dev           # Vite dev server only (browser)
cargo tauri dev                           # full desktop app (native window)
```

`cargo tauri dev` builds the React frontend and the native shell together; the
window is defined in `src-tauri/tauri.conf.json`.

### Live capture (Windows)

The desktop shell can capture your live traffic via **Npcap**. This is a Windows
capability today, gated behind the `netpulse-platform/live-capture` feature (the
default workspace build stays dependency-free — the feature is only enabled for
the shell on Windows).

One-time setup:

1. Install **[Npcap](https://npcap.com/#download)** with *"WinPcap API-compatible
   mode"* checked (needed at runtime).
2. Install the **Npcap SDK** (same page) so `wpcap.lib` is available at link time.
   Point the linker at it, e.g. in PowerShell before building:
   ```powershell
   $env:LIB = "C:\npcap-sdk\Lib\x64;$env:LIB"
   ```
3. Run the app **elevated** (packet capture needs admin).

Then launch and click **Start capture** in the header (it uses your default
adapter). Flows and narrative cards populate as you browse; **Stop capture** ends
it. If Npcap is missing or you're not elevated, capture fails closed with an
honest message rather than pretending — the screens stay in their empty state.

> Prefer to work offline? Skip all of the above and set `NETPULSE_PCAP=<file>`
> before `cargo tauri dev` to load a saved capture instead (no Npcap needed).

### Quality gates (what CI runs)

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Regenerate the UI TypeScript types from the Rust API contract:
cargo test -p netpulse-api -- --ignored write_contract
pnpm --filter @netpulse/contract typecheck
```

The API contract is drift-checked: if the Rust schema and the committed
TypeScript types disagree, `cargo test` fails.

---

## Repository layout

```
crates/      13 Rust crates — the product layers (see the diagram above)
plugins/     first-party reference plugins (dissector, detector, enrichment, export)
ui/          pnpm workspace — app + design-system, components, viz, contract packages
src-tauri/   the Tauri desktop shell (its own build, excluded from the cargo workspace)
docs/        the complete design specification, 00–25
fixtures/    test capture fixtures    fuzz/  parser fuzz targets    scripts/  automation
```

---

## Documentation

The complete design lives in [`docs/`](docs/README.md). Start with
[`docs/0-foundation/00_Project_Overview.md`](docs/0-foundation/00_Project_Overview.md),
then read by phase (`1-` … `5-`). Contributor rules are in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
