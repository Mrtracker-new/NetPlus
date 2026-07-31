# Development & Release Automation Scripts (`scripts/`)

Cross-platform automation tools for building, packaging, testing, and contract codegen.

---

## Script Policies

- **Cross-Platform**: Automation scripts use Node.js or Rust to guarantee identical execution on Windows, macOS, and Linux.
- **CI/CD Integration**: Scripts in this directory are invoked by GitHub Actions workflows ([`.github/workflows/`](../.github/workflows/)) for quality gate enforcement.
