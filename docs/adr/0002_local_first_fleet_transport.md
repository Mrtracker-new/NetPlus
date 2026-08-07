# ADR-002: Local-First Transport & Host Whitelisting for Fleet Observation

## Status
Accepted

## Context
Multi-host observation extends single-host capture to the user's own fleet of servers and devices. This introduces remote data flow that must remain strictly aligned with the **Local-First** invariant.

## Decision
Fleet observation communicates exclusively with explicitly user-configured hosts over local mTLS or token-authenticated framed binary channels (`FramedHeader` with version negotiation). Cloud discovery, third-party analytics, and outbound default telemetry are forbidden.

## Consequences
- Guarantees data privacy; traffic capture remains confined to the user's controlled infrastructure.
- Forward and backward protocol compatibility is maintained via framed binary codecs (`PostcardCodec`/`BincodeCodec`/`JsonCodec`).
