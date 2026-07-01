# NetPulse

> **Making the Invisible Internet Visible.**
> The world's most beginner-friendly yet professional Internet Observability Platform.

NetPulse reconstructs, explains, and teaches the *complete story* behind every
network event on your own computer — locally, privately, and beautifully. Where
traditional analyzers show raw packets first, NetPulse shows **understanding**
first: what happened, why, what it means, and whether anything is wrong — with
raw packets always one click away.

- **Observe, don't intervene** — never blocks, injects, or modifies traffic.
- **Local-first** — all core function works offline; no capture data leaves the
  machine by default. One auditable egress boundary (the opt-in AI assistant).
- **Honest over reassuring** — every security/anomaly finding carries a
  calibrated confidence and links to the exact evidence.
- **Understanding-first, progressive disclosure** — one rich data model, three
  default depths (Beginner / Intermediate / Expert).

## Status

**Foundation phase (Phase 0).** The repository skeleton is in place: the Rust
workspace, the shared data model (`netpulse-core`), and stubs for every layer.
Nothing captures traffic yet — that begins in Phase 1 (`docs/1-phase1-capture-core`).

## Architecture at a glance

Polyglot by design (`docs/0-foundation/03_Technology_Stack.md`):

- **Rust engine** — capture, decode, flow reconstruction, storage, intelligence.
  Memory-safe parsing of hostile bytes; a sharded, lock-free hot path.
- **Tauri + React + WebGL UI** (Phase 2) — a beautiful, 60 fps desktop app.
- **Local-first stores + local AI** — SQLite + columnar; ONNX inference; a
  pluggable, local-default AI explanation service.

The crate dependency graph *is* the layer diagram — see `ARCHITECTURE.md`.

## Build

Requires the pinned toolchain in `rust-toolchain.toml` (Rust 1.96).

```sh
cargo build --workspace     # compile every crate
cargo test  --workspace     # run all tests
cargo fmt   --all --check    # formatting
cargo clippy --workspace -- -D warnings
cargo run   -p netpulse-engine   # start the (stub) analysis engine
```

The TypeScript/React UI (`ui/`) is scaffolded as stubs only in this phase; its
build (pnpm + Vite + Tauri) is wired in Phase 2.

## Documentation

The complete pre-implementation design lives in [`docs/`](docs/README.md) — read
`docs/0-foundation/00_Project_Overview.md` first.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
