# Shipped Local ONNX Models & Model Cards (`models/`)

Local ONNX inference models (`.onnx`) and accompanying model cards documenting training data, intended use cases, and performance limitations.

---

## Directory Governance & Status

- **Architectural Status**: Reserved directory for shipped local ONNX inference models (`.onnx`) and model transparency cards.
- **Source Control Policy**: Git tracks this directory via `README.md`. Models and cards are committed when exported from the `research/` pipeline.
- **Runtime Graceful Degradation**: As specified in `netpulse-intel::anomaly`, the engine executes an interpretable statistical floor (Welford mean/variance) that operates 100% offline without ONNX dependencies. ONNX models act as optional enhancements.
- **Population Trigger**: Populated when trained anomaly detection models pass evaluation in `research/` and are packaged for engine inference.

---

## Model Transparency Policy

Every anomaly detection model shipped in this directory includes a corresponding model card disclosing:
- Training datasets and baseline distribution assumption.
- Intended usage boundaries and false-positive risk factors.
- Hardware resource bounds and execution requirements.

All model inference is performed locally using the ONNX Runtime CPU engine — no telemetry or model inputs leave the computer.

