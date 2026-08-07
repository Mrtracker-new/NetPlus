# ADR-001: Compile-Time Socket Isolation for Protocol Sandbox

## Status
Accepted

## Context
NetPulse operates under the strict invariant **Observe-Only**. The Protocol Sandbox feature enables interactive packet building and field-level educational decoding against RFC specifications.

## Decision
The Protocol Sandbox module (`netpulse-learn::sandbox`) is compiled **without physical network socket dependencies**. Constructed packets are processed and dissected exclusively in-memory against `netpulse-decode`. There is no physical code path capable of transmitting constructed frames onto a physical network interface.

## Consequences
- Preserves NetPulse's observe-only boundary and security model.
- Prevents accidental or malicious packet injection from educational tools.
