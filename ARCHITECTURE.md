# Architecture

NetPulse's full system architecture is specified in
[`docs/0-foundation/02_System_Architecture.md`](docs/0-foundation/02_System_Architecture.md),
with the repository layout in
[`docs/0-foundation/04_Project_Structure.md`](docs/0-foundation/04_Project_Structure.md).

This file is a short pointer plus the one rule a contributor must internalize
before touching the workspace.

## The layering rule

The crate dependency graph **is** the layer diagram. Arrows point strictly
downward; a higher-layer crate may depend on lower ones, never the reverse.
Cargo enforces this — a cycle will not compile.

```
netpulse-engine (bin) ┐  netpulse-capture-svc (bin) ┐
        │             │           │                 │
  api  learn  ai  intel  narrative  flow  decode  storage  capture
        │      │    │        │       │      │        │        │
        └──────┴────┴────────┴───────┴──────┴────────┴──── netpulse-platform
                                   │                              │
                              netpulse-core  (the shared vocabulary — base)
```

Key invariants the structure enforces (see `docs/04` §7):

- **Parser isolation.** `netpulse-decode` depends only on `netpulse-core` and is
  fuzzed in isolation — it is the primary hostile-input attack surface.
- **Single egress boundary.** Only `netpulse-ai` may make outbound network
  connections. Verifying "no capture data leaves by default" reduces to
  inspecting one crate.
- **Platform isolation.** All `#[cfg(target_os)]` code lives in
  `netpulse-platform`. Everything above it is platform-neutral.
- **One API contract.** `netpulse-api` is the single versioned source of truth
  for the backend↔frontend boundary; the UI's TypeScript types are generated
  from it and cannot drift.
- **Privilege minimization.** `netpulse-capture-svc` has a deliberately tiny
  dependency set; it holds capture capability and nothing else.
