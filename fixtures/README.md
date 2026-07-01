# fixtures/

Recorded captures used as **deterministic test inputs**.

Because sessions replay deterministically (`docs/21`), the entire pipeline —
reconstruction, narrative, detection — can be tested against fixed capture files
with no live network. This powers reproducible CI and lets contributors without
capture privileges run the full test suite (`docs/03` §12, `docs/04` §9).

**Status: empty at foundation stage.** Fixtures are added alongside Phase 1
integration tests (`docs/05`–`08`).
