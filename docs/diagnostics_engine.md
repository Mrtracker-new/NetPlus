# NetPlus Diagnostics Engine Architecture & Developer Guide

## 1. Architectural Overview

The NetPlus Diagnostics system implements a truthful, deterministic, resilient, and testable network diagnostic pipeline across a strict four-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                 React UI / Diagnostics Screen               │
│               (Presentation, Controls, Feedback)           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Orchestrates & Subscribes
┌──────────────────────────────▼──────────────────────────────┐
│       Diagnostic Domain Engine (Pure TypeScript)            │
│   (Baselines, Anomaly Detection, Evidence, Inference)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Typed IPC Queries
┌──────────────────────────────▼──────────────────────────────┐
│           Platform & Query Layer (Rust / Tauri)             │
│       (IPC Dispatch, Safe Sockets, OS Routing, DNS)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ Non-root OS Operations
┌──────────────────────────────▼──────────────────────────────┐
│                    OS / Network Runtime                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Probe Capabilities & Provenance

Every diagnostic probe explicitly declares its measurement provenance:

| Probe | Platform Mechanism | Metrics Captured | Provenance |
| :--- | :--- | :--- | :--- |
| **Gateway Discovery** | Read-only route table / interface check | `gateway_ip`, `interface_name`, `status` | `live` / `unavailable` |
| **DNS Probe** | OS platform resolver (`ToSocketAddrs`) with timeout | `resolution_rtt_ms`, `resolved_ips`, `timed_out`, `error` | `live` / `unavailable` |
| **Ping Probe** | Cross-platform ICMP / synthetic socket | `loss_pct`, `min_rtt_ms`, `avg_rtt_ms`, `max_rtt_ms`, `stddev_rtt_ms` | `simulated` / `live` |
| **Traceroute Probe** | TTL increment route path probe | `ttl`, `ip`, `hostname`, `rtt_ms`, `status` | `simulated` / `live` |
| **Bufferbloat Probe** | Dual-phase idle baseline vs loaded traffic delta | `idle_rtt_ms`, `loaded_rtt_ms`, `delta_rtt_ms`, `grade` | `simulated` / `live` |
| **HTTP Probe** | Bounded socket HTTP probe (15s timeout, 256 KB limit) | `status_code`, `connect_ms`, `ttfb_ms`, `transfer_ms`, `tls_ms: None` | `live` / `unavailable` |

### Truthfulness & Zero Fabrication Rules
1. **Never fabricate missing data**: If a probe or metric fails, it returns `None` (`null`) with an explicit limitation / error string rather than a placeholder default.
2. **Provenance tagging**: Every measurement output carries `source` (`"live" | "simulated" | "derived" | "unavailable"`).
3. **Simulated severity capping**: Any metric derived from simulated probes has its severity capped at `"elevated"` (never `"severe"`).

---

## 3. Hard Invariants Enforced by the Inference Engine

The pure deterministic TypeScript inference engine (`ui/app/src/diagnostic/inference.ts`) strictly enforces the following diagnostic invariants:

1. **Traceroute Intermediate Timeouts ≠ End-to-End Packet Loss**:
   - Intermediate hops in traceroute that discard ICMP TTL-exceeded messages (`* * *`) with 0% target ping loss **MUST NOT** diagnose end-to-end `PACKET_LOSS` or `ROUTING` failure (confidence `< 0.10`, not in top diagnoses).
2. **Gateway Loss vs Target Loss Separation**:
   - Local gateway packet loss does not equal target end-to-end packet loss. If gateway has loss but target has 0% loss, the diagnosis is localized to `LOCAL_NETWORK` or `GATEWAY`, not end-to-end `PACKET_LOSS`.
3. **Gateway Precedence**:
   - Severe gateway latency or unreachable gateway escalates `LOCAL_NETWORK` / `GATEWAY` and contextualizes downstream delays.
4. **Bufferbloat Delta**:
   - Bufferbloat is evaluated on delta latency under load (`loaded_rtt_ms - idle_rtt_ms`) rather than absolute loaded RTT alone.
5. **HTTP TTFB Uncertainty**:
   - Bounded HTTP TTFB measurements without separate TLS timing breakdowns are flagged with uncertainty and lower confidence weights.
6. **Monotonic Session Concurrency Protection**:
   - Session IDs are strictly monotonic. Results from session $N$ can never commit or overwrite state for session $N+1$.
7. **Non-Destructive Cancellation**:
   - If a pipeline session is cancelled, subsequent probes are halted while all partial observations collected up to the cancellation point are preserved and evaluated.

---

## 4. Scoped v1 Diagnostic Categories

The engine maps all observations to one or more prioritized categories:
- `LOCAL_NETWORK`
- `GATEWAY`
- `DNS`
- `ROUTING`
- `PACKET_LOSS`
- `BUFFERBLOAT`
- `REMOTE_SERVICE_RESPONSE`
- `BANDWIDTH`
- `UNKNOWN`

---

## 5. Running Tests & Verifying Contracts

```bash
# Run all Rust crate tests (including single egress boundary & contract codegen tests)
cargo test --workspace

# Run TypeScript unit tests (including all 5 mandatory diagnostic fixtures)
pnpm --filter @netpulse/app test

# Verify TypeScript types and build
pnpm --filter @netpulse/app typecheck
pnpm --filter @netpulse/app build
```
