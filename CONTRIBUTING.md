# Contributing to NetPulse

Thank you for contributing to NetPulse! NetPulse aims to make network understanding accessible to everyone without sacrificing technical depth. Contributions of code, dissectors, detectors, visualizers, lessons, and documentation are all welcome.

---

## 1. Before You Start

1. Review [`ARCHITECTURE.md`](ARCHITECTURE.md) to understand the core vision, system architecture, technology stack, and repository layering rules.
2. Every feature must satisfy the **Feature Acceptance Filter**:
   - It must answer at least one of the six fundamental questions:
     - *What happened?*
     - *Why did it happen?*
     - *What is happening right now?*
     - *What happens next?*
     - *What does it mean?*
     - *What should I do?*
   - It must satisfy all hard constraints: **local-first**, **observe-only**, **honest confidence**, **budgeted performance**, and **progressive disclosure**.

---

## 2. Component On-Ramp

Find the layer appropriate for your change:

| Goal | Primary Location | Key Concepts |
|---|---|---|
| Add or improve a protocol dissector | `crates/netpulse-decode` & `fuzz/` | Zero-copy parsing, explanation keys, fuzzing |
| Add a security or anomaly detector | `crates/netpulse-intel` | Rules engine, calibrated confidence, evidence links |
| Create a visualization primitive | `ui/packages/viz` | WebGL/Canvas, D3 scales, 60 fps target |
| Add or modify a UI screen | `ui/app/src/screens` | Progressive disclosure, responsive layouts |
| Write an interactive lesson | `crates/netpulse-learn` | Grounded learning, website loading journeys |
| Support OS platform features | `crates/netpulse-platform` | Socket attribution, platform isolation, raw capture |
| Extend export capabilities | `plugins/` & `netpulse-plugin` | Export plugin seam, strict privacy controls |

---

## 3. Step-by-Step Developer Workflows

### Workflow A: Adding a New Protocol Dissector

1. **Implement Dissector**: Open [`crates/netpulse-decode/src/`](crates/netpulse-decode/src/) and create a new module implementing the protocol parser.
2. **Zero-Copy & Safety**: Parse using byte slices (`&[u8]`) without unnecessary allocations. Ensure `#![forbid(unsafe_code)]` or justify any unsafe usage.
3. **Explanation Keys**: Assign stable explanation keys to key fields (e.g., `dns.qtype`, `tls.sni`) so the education engine (`netpulse-learn`) and AI backend can link explanations.
4. **Add Unit Tests & Fixtures**: Place sample capture files in [`fixtures/`](fixtures/) and write unit tests in `netpulse-decode`.
5. **Add Fuzz Target**: Create a corresponding `cargo-fuzz` target in [`fuzz/fuzz_targets/`](fuzz/fuzz_targets/) to ensure hostile byte inputs never crash the engine.

### Workflow B: Adding a Security Detector

1. **Implement Detector**: Open [`crates/netpulse-intel/src/rules.rs`](crates/netpulse-intel/src/rules.rs) and create a new rule implementing the `Detector` trait.
2. **Evidence Invariant**: Every `Finding` returned **must** include immutable evidence references (`flow_id`, `packet_id`, or `session_id`). Findings without evidence are invalid.
3. **Calibrated Confidence**: Assign a confidence score (`Low`, `Medium`, `High`, `Certain`) based on factual signal strength — never overstate findings.
4. **Add Tests**: Write unit tests asserting both detection on malicious traffic and false-positive resilience on normal traffic.

### Workflow C: Modifying the API Schema & Contract

1. **Modify DTOs**: Update Rust types in [`crates/netpulse-api/src/dto.rs`](crates/netpulse-api/src/dto.rs).
2. **Regenerate TypeScript Contract**:
   ```sh
   cargo test -p netpulse-api -- --ignored write_contract
   ```
3. **Verify Contract**: Run typechecking across the UI workspace:
   ```sh
   pnpm --filter @netpulse/contract typecheck
   ```

### Workflow D: Adding UI Screens & Components

1. **Design System**: Use tokens, typography, and colors from `@netpulse/design-system`. Never hardcode ad-hoc hex colors.
2. **Progressive Disclosure**: Respect the user's selected depth level (`Beginner`, `Intermediate`, `Expert`).
3. **Visual Density**: Ensure data density scales smoothly without layout breakage across window sizes.

---

## 4. Quality Gates & Local Checks

Run these commands before pushing any commits:

```sh
# 1. Rust Formatting
cargo fmt --all --check

# 2. Rust Linter
cargo clippy --workspace --all-targets -- -D warnings

# 3. Rust Workspace Tests
cargo test --workspace

# 4. Documentation Status & Link Verification
python scripts/verify_docs_status.py

# 5. TypeScript Contract & Application Checks
pnpm --filter @netpulse/contract typecheck
pnpm --filter @netpulse/app typecheck
```

### Documentation Ownership & Status Rule

Documentation must strictly reflect the current implementation state of the source code.
Whenever a pull request changes the maturity status of a crate or capability (e.g. implementing live capture or SQLite storage):
1. Audit crate code and update [`docs/status.yml`](docs/status.yml).
2. Update status tables in `README.md`, `ARCHITECTURE.md`, `docs/README.md`, and `crates/README.md`.
3. Run `python scripts/verify_docs_status.py` to confirm zero drift and zero broken links before opening a PR.

### Toolchain Pinning & Upgrade Policy

NetPulse intentionally pins Rust `1.96.0` to match [`rust-toolchain.toml`](rust-toolchain.toml) and [`Cargo.toml`](Cargo.toml) (`workspace.rust-version`).

Whenever upgrading the Rust toolchain version, maintainers must update all synchronized locations together:
1. [`rust-toolchain.toml`](rust-toolchain.toml) (`channel = "1.9X.0"`)
2. [`Cargo.toml`](Cargo.toml) (`workspace.rust-version = "1.9X"`) and [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)
3. [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (`toolchain: 1.9X.0` in `rust` and `audit` jobs)
4. Run full local quality gates (`cargo fmt`, `cargo clippy`, `cargo test`)
5. Regenerate `Cargo.lock` only if dependency resolution changes require it

### Dual Lockfile Architecture & Maintenance Policy

NetPulse maintains two independent Cargo lockfiles:
1. **Root Workspace**: [`Cargo.lock`](Cargo.lock) (governs `crates/*` and `plugins/*`).
2. **Desktop Shell**: [`src-tauri/Cargo.lock`](src-tauri/Cargo.lock) (governs `src-tauri`).

#### Why are there two `Cargo.lock` files?
`src-tauri` is intentionally excluded from the root workspace (`exclude = ["src-tauri", "fuzz"]` in root `Cargo.toml`) so that pure-Rust CI jobs can run fast and headless without requiring platform webview system dependencies.

#### Lockfile Ownership & Update Rules:
- **Root Dependency Updates**: Modifies root `Cargo.lock`.
- **Desktop Shell Dependency Updates**: Modifies `src-tauri/Cargo.lock`.
- **Workspace Path Dependency Interface Changes**: Shared crate changes may legitimately update both `Cargo.lock` and `src-tauri/Cargo.lock` simultaneously.
- **Immutability Enforcement**: Both lockfiles are tracked in Git, audited independently in CI (`cargo audit` and `cargo deny`), receive weekly Dependabot updates, and must remain committed. Neither lockfile should ever be deleted or untracked.


---

## 5. Architectural Rules & Dependency Policy

- **No Upward Dependencies**: Never introduce a dependency from a lower crate to a higher crate.
- **Dependency Minimization**: Third-party dependencies are attack surface. Prefer audited, standard Rust crates.
- **Egress Isolation**: No new dependency may introduce background network calls. All outbound network traffic is restricted to `netpulse-ai`.

---

## 6. Commit & Pull Request Guidelines

- **Commit Messages**: Write clear, descriptive commit titles and bodies explaining *why* a change was made.
- **CI Readiness**: Ensure all local quality gate checks pass cleanly before opening a pull request.
