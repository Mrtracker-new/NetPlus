# Shipped Local ONNX Models & Model Cards (`models/`)

Local ONNX inference models (`.onnx`) and accompanying model cards documenting training data, intended use cases, and performance limitations.

---

## Model Transparency Policy

Every anomaly detection model shipped in this directory includes a corresponding model card disclosing:
- Training datasets and baseline distribution assumption.
- Intended usage boundaries and false-positive risk factors.
- Hardware resource bounds and execution requirements.

All model inference is performed locally using the ONNX Runtime CPU engine — no telemetry or model inputs leave the computer.
