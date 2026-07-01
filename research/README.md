# research/

Offline ML training notebooks and scripts. **Python is allowed here** — and
only here.

This directory is **not shipped** with the product (`docs/03` §6). It keeps
Python entirely out of the runtime: models are trained here, exported to
`.onnx`, and the shipped product runs them via ONNX Runtime with no Python
dependency.

**Status: empty at foundation stage.** Used in Phase 4 model development.
