# Offline Model Training & Research (`research/`)

Offline model training notebooks, feature engineering scripts, and evaluation pipelines.

---

## Directory Governance & Status

- **Architectural Status**: Reserved workspace for offline ML research, feature engineering, and model training pipelines.
- **Source Control Policy**: Git tracks this directory via `README.md`. Python ML scripts and configuration are committed as research tools are developed.
- **Population Trigger**: Populated when building offline training notebooks or feature extraction pipelines to train new models.

---

## Workspace Rules

- **Isolated Python Usage**: Python tools and ML libraries (PyTorch, scikit-learn, ONNX tools) are strictly restricted to this directory.
- **Runtime Exclusion**: `research/` is excluded from application production builds. Trained models are exported to `.onnx` and committed to [`models/`](../models/), allowing the engine runtime to execute inference via ONNX Runtime without Python dependencies.

