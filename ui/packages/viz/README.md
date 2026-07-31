# `@netpulse/viz`

High-performance WebGL and Canvas visualization primitives for NetPulse.

---

## Technical Approach

To achieve 60 fps rendering under heavy packet capture streaming without DOM overhead, `@netpulse/viz` separates layout math from rendering:

- Uses **D3** for scale transformations, time axes, and force-directed node positioning.
- Paints using **HTML5 Canvas 2D** or **WebGL** shaders rather than SVG/DOM elements.
- Decoupled from React framework state — primitives consume lightweight data structures directly from the state store.

---

## Visualization Primitives

- **`Sparkline`**: Compact sparkline component for real-time process bandwidth and flow rates.
- **`AreaChart`**: Smooth, multi-layer throughput chart tracking ingress/egress bytes over time.
- **`Donut`**: Interactive protocol breakdown chart.
- **`FlowDiagram`**: Interactive node-link request flow mapping website loading sequences (DNS → TCP → TLS → HTTP) with animated packet particles.
- **`ConfidenceMeter`**: Meter visualizing threat detector confidence scores.
- **`PulseIndicator`**: Animated indicator showing live capture status and ring buffer health.
