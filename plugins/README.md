# plugins/

First-party example plugins — reference implementations for each extension seam
(`docs/24`): dissector, enrichment, detector, view/panel, and export plugins.

Each seam sits at a layer boundary and consumes only that layer's contract,
preserving the strict layering (`docs/02` §4, §15). These examples show
contributors how to extend NetPulse without forking.

**Status: empty at foundation stage.** Populated in Phase 5 (`docs/24`).
