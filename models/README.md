# models/

Shipped ONNX model files (`.onnx`) plus **model cards** documenting each model's
training data, intended use, and known limits.

The model card is a honesty requirement (`docs/01` §7.2): a card discloses what
an anomaly model can and cannot do. ML is *augmentation*; deterministic rules are
the floor (`docs/03` §16, `docs/20`).

Inference is local and CPU-capable (ONNX Runtime, `docs/03` §6) — no network call.

**Status: empty at foundation stage.** Populated in Phase 4 (`docs/20`).
