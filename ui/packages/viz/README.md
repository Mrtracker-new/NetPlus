# @netpulse/viz

WebGL/Canvas visualization primitives — large node-link connection graphs, dense
scrubbing timelines, and particle-style packet-flow animations at 60 fps
(`docs/0-foundation/03_Technology_Stack.md` §10, `docs/16`).

Intentionally **framework-light** so the expensive-to-build rendering code is
insulated from any future React change. Uses D3 for its *math* (scales, force
layout, time axes) and paints with WebGL/Canvas rather than DOM/SVG.

**Status: foundation stub.** Phase 3 (`docs/10`, `docs/16`).
