# netpulse-shell (`src-tauri`)

The Tauri desktop shell (`docs/0-foundation/03_Technology_Stack.md` §8). It hosts
the React webview from `ui/app` and bridges the enumerated
`netpulse-api` Query/Command surface to `netpulse-engine` (`src/main.rs`).

**Deliberately outside the Rust workspace.** The root `Cargo.toml` excludes
`src-tauri` because building it requires the platform webview libraries and the
Tauri CLI, which the pure-Rust CI job does not provision. It builds under the UI
toolchain instead:

```
cargo install tauri-cli --version '^2'   # once
pnpm install                             # from repo root (workspace)
cargo tauri dev                          # from src-tauri/
```

## What is real vs. stubbed

- **Real:** the IPC bridge — `query`/`command` map the contract to the engine's
  read-only presentation view (`present()`), keeping the observe-only guarantee
  auditable (two commands, nothing else).
- **Stubbed (honest):** live capture and recording refuse with a clear error,
  because the per-OS capture backend is still a documented stub in
  `netpulse-platform` (Phase 1). Attribution answers `Unknown` until a live
  `SocketTableSource` is wired (`docs/12` §4).

## Npcap SDK Path Configuration (Windows Live Capture)

When compiling on Windows with Npcap live capture support, the build script dynamically resolves the Npcap SDK linker search path in the following order:

1. `NPCAP_SDK_PATH` environment variable (e.g., `NPCAP_SDK_PATH=C:\npcap-sdk`)
2. `LIB` environment variable
3. `VCPKG_ROOT` directory (`%VCPKG_ROOT%\installed\x64-windows\lib`)
4. `%ProgramFiles%\Npcap SDK\Lib\x64`
5. `C:\npcap-sdk\Lib\x64`

No hardcoded machine paths are committed in `.cargo/config.toml`.

## Note on assets

`icons/icon.png` and a real code-signing/bundle config are added when packaging
is set up; they are intentionally absent from this scaffold.
