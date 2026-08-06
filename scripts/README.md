# Development & Release Automation Scripts (`scripts/`)

Cross-platform automation tools for building, packaging, testing, and contract codegen.

---

## Directory Governance & Status

- **Architectural Status**: Reserved directory for cross-platform release automation, packaging, and codegen scripts.
- **Source Control Policy**: Git tracks this directory via `README.md`. Automation scripts are committed when standalone scripts are required.
- **Population Trigger**: Populated when extracting shared cross-platform build/release automation logic out of inline CI steps.

---

## Script Policies

- **Cross-Platform**: Automation scripts use Node.js or Rust to guarantee identical execution on Windows, macOS, and Linux.
- **CI/CD Integration**: Scripts in this directory are invoked by GitHub Actions workflows ([`.github/workflows/`](../.github/workflows/)) for quality gate enforcement.

