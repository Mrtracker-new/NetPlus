# Contributing to NetPulse

Thank you for your interest. NetPulse aims to make network understanding
accessible without dumbing it down — contributions of code, lessons,
visualizations, and documentation are all welcome.

## Before you start

1. Read the foundation docs (`docs/0-foundation/00`–`04`). They are short and
   they define the vision, the architecture, and the layout every change must
   respect.
2. Every feature must pass the **feature-acceptance filter** (`docs/01` §6): it
   answers at least one of the six questions (*what happened / why / what's
   happening now / what's next / what does it mean / what should I do*) **and**
   satisfies every hard constraint (local-first, observe-only, honest, budgeted,
   progressive). We do not add features because competitors have them.

## Where your change belongs

The repository layout is architecture made physical. Find your on-ramp
(`docs/04` §10):

| I want to… | Work in… | Read first |
|---|---|---|
| Add a protocol dissector | `crates/netpulse-decode` + `fuzz/` | `docs/07` |
| Add a security/anomaly detector | `crates/netpulse-intel` | `docs/17`, `18`, `20` |
| Improve a visualization | `ui/packages/viz` | `docs/10`, `16` |
| Add/adjust a UI screen | `ui/app/src/screens` | `docs/09`–`15` |
| Write a lesson | `crates/netpulse-learn` + content | `docs/13` |
| Port to a new OS | `crates/netpulse-platform` | `docs/05`, `12` |
| Add an export format | export plugin + `netpulse-api` | `docs/23`, `24` |
| Tune the AI explanations | `crates/netpulse-ai` | `docs/19` |

## The layering rule

The crate dependency graph must stay a strict downward hierarchy (see
`ARCHITECTURE.md`). Cargo rejects cycles, but also avoid reaching *around*
layers. If your change wants an upward dependency, the design is probably wrong —
open a discussion first.

## Dependency policy

Dependencies are attack surface (`docs/03` §14). Prefer few, well-audited,
widely-used crates. **No dependency may introduce mandatory network egress** —
outbound networking belongs only in `netpulse-ai`.

## Local checks (run before pushing)

```sh
cargo fmt --all
cargo clippy --workspace -- -D warnings
cargo build --workspace
cargo test  --workspace
```

Dissectors additionally require a fuzz target and property tests where
applicable. The whole pipeline is testable without a live network by replaying
fixtures in `fixtures/` (`docs/21`).

## Commit and PR conventions

- Keep commits focused; write messages that explain *why*.
- Reference the relevant doc section(s) in non-trivial changes.
- CI runs the 3-OS matrix (build, test, fmt, clippy) — it must be green.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
