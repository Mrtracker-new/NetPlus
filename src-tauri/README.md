# `netpulse-shell` (`src-tauri`)

The desktop application shell for NetPulse, powered by Tauri v2.

---

## Architecture & Responsibilities

`src-tauri` hosts the native OS window, embeds the Vite React frontend (`ui/app`), and exposes Tauri IPC commands bridging backend queries from `netpulse-engine` to the UI webview.

> **Dependency Graph & Governance Note**: `src-tauri` maintains an independent Cargo dependency graph (`src-tauri/Cargo.lock`) excluded from the root workspace to keep pure-Rust CI builds fast and webview-free. It receives identical security governance in CI (`cargo audit` and `cargo deny`) and weekly automated Dependabot updates under the `desktop-shell` group.

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
└─────────────────────────────────────────────────────────────┘
```

---

## Building & Running

### Prerequisites
- Install Tauri CLI v2: `cargo install tauri-cli --version '^2'`
- Node.js 20+ and pnpm 9 installed

### Execution Commands
```sh
# Run desktop app with hot-reloading native shell (from repo root):
cargo tauri dev

# Build production application bundle:
cargo tauri build
```

---

## Windows Npcap SDK Linker Configuration

When compiling on Windows with live capture support (`netpulse-platform/live-capture`), the build script dynamically resolves the Npcap SDK linker search path in the following order:

1. `NPCAP_SDK_PATH` environment variable (e.g., `$env:NPCAP_SDK_PATH = "C:\npcap-sdk"`)
2. `LIB` environment variable
3. `VCPKG_ROOT` directory (`%VCPKG_ROOT%\installed\x64-windows\lib`)
4. `%ProgramFiles%\Npcap SDK\Lib\x64`
5. `C:\npcap-sdk\Lib\x64`
