# ADR-004: Centralized CapabilityRegistry & Prerequisite Dependency Graph

## Status
Accepted

## Context
Network diagnostic features (raw sockets, ICMP ping, traceroute, container netns inspection) depend on OS privileges and installed runtimes. Hardcoded platform assumptions lead to runtime crashes or unhelpful error dialogs.

## Decision
System capabilities are registered dynamically in `netpulse-core::capabilities::CapabilityRegistry` with explicit prerequisite dependency graphs (`CapabilityNode`). The UI queries this single registry to display clear, actionable explanations when a feature is unavailable (e.g. *"Administrator privileges required for raw socket traceroute"*).

## Consequences
- Graceful UI feature degradation across Windows, Linux, and macOS.
- Unified capability query endpoint for both internal UI and future plugin extensions.
