# Offline Model Training & Research (`research/`)

Offline model training notebooks, feature engineering scripts, and evaluation pipelines.

---

## Workspace Rules

- **Isolated Python Usage**: Python tools and ML libraries (PyTorch, scikit-learn, ONNX tools) are strictly restricted to this directory.
- **Runtime Exclusion**: `research/` is excluded from application production builds. Trained models are exported to `.onnx` and committed to [`models/`](../models/), allowing the engine runtime to execute inference via ONNX Runtime without Python dependencies.
