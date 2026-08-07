# ADR-003: Explanation Provenance & Calibrated Confidence Scoring

## Status
Accepted

## Context
The Session Semantic Diff Engine analyzes performance deltas between sessions (e.g. HTTP/1.1 vs HTTP/3). NetPulse enforces the **Honest Verdicts** invariant, forbidding manufactured certainty or false diagnostic verdicts.

## Decision
All generated narratives from the diff engine must attach:
1. A calibrated confidence score (`High`, `Medium`, `Low`).
2. An explicit evidence trace array detailing the underlying empirical metrics (e.g. RTT drop %, ALPN negotiation, retransmission count).

## Consequences
- Prevents overstating causality or guessing network failure root causes.
- Provides full auditability for every user-facing natural language explanation.
