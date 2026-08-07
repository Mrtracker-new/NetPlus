# NetPulse Documentation Suite

> **NetPulse** — *Making the Invisible Internet Visible.*
> A beginner-friendly, production-grade Internet Observability Platform.

This directory contains the canonical documentation for NetPulse, including component maturity tracking, architectural decision records, observability guidelines, and implementation roadmaps.

---

## Active Documentation

| Document | Purpose |
|---|---|
| [`status.yml`](status.yml) | **Single Source of Truth** for component implementation maturity across Rust crates and UI packages. |
| [`observability.md`](observability.md) | Telemetry, logging standards, event taxonomy, and health probe specifications. |
| [`adr/`](adr/) | Architectural Decision Records (sandboxing, transport, provenance, registry). |

---

## Core System Constraints

1. **Observe, don't intervene**: Never block, inject, or modify network traffic.
2. **Local-first**: All parsing, storage, and rules run offline. Single egress boundary in `netpulse-ai`.
3. **Honest confidence**: Findings require evidence references and explicit confidence ratings.
4. **Understanding-first**: High-level narrative summaries precede raw packet details.
5. **Progressive disclosure**: Three levels (Beginner, Intermediate, Expert) over one data model.
