# `netpulse-shell` (`src-tauri`)

The desktop application shell for NetPulse, powered by Tauri v2.

---

## Architecture & Responsibilities

`src-tauri` hosts the native OS window, embeds the Vite React frontend (`ui/app`), and exposes Tauri IPC commands bridging backend queries from `netpulse-engine` to the UI webview.

> **Dependency Graph & Governance Note**: `src-tauri` maintains an independent Cargo dependency graph (`src-tauri/Cargo.lock`) excluded from the root workspace to keep pure-Rust CI builds fast and webview-free. It receives full security governance in CI (`cargo audit` and `cargo deny`), automated unit/integration test validation (`tauri-check`), and 3-OS cross-platform installer compilation (`tauri-build`).

```
┌─────────────────────────────────────────────────────────────┐
│                       React Webview                         │
│                    (`ui/app` single-page app)               │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC (invoke / emit)
┌──────────────────────────────▼──────────────────────────────┐
│                    Tauri Shell (`src-tauri`)                │
│  - Window Management                                        │
│  - IPC Command Router (`src/main.rs`)                       │
│  - Live Capture Stream Events (`feed-delta`)                │
└──────────────────────────────┬──────────────────────────────┘
                               │ Query / Command (`netpulse-api`)
┌──────────────────────────────▼──────────────────────────────┐
│                   Rust Engine (`netpulse-engine`)           │
└──────────────────────────────┴──────────────────────────────┘
```

---

## Building & Running

### Prerequisites
- Install Node.js 22 and pnpm 9 installed (`pnpm install`)
- Linux C/C++ WebKitGTK dev headers: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`

### Execution Commands
```sh
# Run desktop app with hot-reloading native shell (from repo root):
pnpm --filter @netpulse/app tauri dev

# Build production application bundle:
pnpm --filter @netpulse/app tauri build
```

---

## Local CI Replication & Verification Commands

Contributors can replicate CI checks locally before submitting PRs:

```sh
# 1. Verify desktop shell compilation
cargo check --manifest-path src-tauri/Cargo.toml --locked

# 2. Run Clippy linting against desktop shell
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings

# 3. Execute all 41 IPC and desktop shell tests
cargo test --manifest-path src-tauri/Cargo.toml --locked

# 4. Build frontend distribution
pnpm --filter @netpulse/app build

# 5. Build Tauri desktop application
pnpm --filter @netpulse/app tauri build
```

---

## Continuous Integration (CI) Desktop Matrix

The `.github/workflows/ci.yml` pipeline defines two desktop shell jobs:

- **`tauri-check`**: Runs on all PRs and pushes across a 3-OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`). Validates `cargo check`, `cargo clippy`, `cargo test`, frontend `vite build`, and lockfile integrity without packaging full installers.
- **`tauri-build`**: Runs on pushes to `main`. Compiles native installers (`.deb`/`.AppImage` on Linux, `.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS), generates SHA-256 checksums, and uploads build artifacts with 14-day retention.

---

## Windows Npcap SDK Linker Configuration

When compiling on Windows with live capture support (`netpulse-platform/live-capture`), the build script dynamically resolves the Npcap SDK linker search path in the following order:

1. `NPCAP_SDK_PATH` environment variable (e.g., `$env:NPCAP_SDK_PATH = "C:\npcap-sdk"`)
2. `LIB` environment variable
3. `VCPKG_ROOT` directory (`%VCPKG_ROOT%\installed\x64-windows\lib`)
4. `%ProgramFiles%\Npcap SDK\Lib\x64`
5. `C:\npcap-sdk\Lib\x64`

