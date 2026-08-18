# ADR-005: Capture Storage Durability, Referential Integrity, and Hydration Lifecycle

## Status
Accepted

## Context
NetPulse aggregates raw network frames across protocol dissectors (`netpulse-decode`) and stateful flow engines (`netpulse-flow`) into six primary runtime entities:
1. **Flows** (`Flow`)
2. **Sessions** (`Session` with causal flow linkages)
3. **Protocol Events** (`ProtoEvent`)
4. **Host Enrichments** (`Host`)
5. **Passive Name Resolutions** (`HostName`)
6. **Security Findings** (`StoredFinding` with evidence references)

For restart resilience and production operational integrity, the runtime storage subsystem requires durable WAL-mode SQLite persistence, atomic transactions across interdependent entities, referential integrity verification on startup, and canonical snapshot equality across restarts.

## Decision
1. **Single Canonical Storage Engine**:
   - `SqliteCaptureRepository` manages persistent SQLite transactions using connection pooling and WAL journaling (`PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`, `PRAGMA foreign_keys=ON`).
   - Sync bridge interfaces on `CaptureStore` invoke canonical async repository operations or fast in-memory paths without nested blocking Tokio runtimes.
2. **Atomic Session Invariant**:
   - `insert_session` inserts session metadata and updates linked `flows.session_id` within a single database transaction.
   - For every linked flow in `session.flow_ids`, the repository verifies `rows_affected == 1`. If any flow ID does not exist, the transaction rolls back immediately with `StorageError::MissingFlowForSessionLink`.
3. **Unified `open_sqlite()` Lifecycle & Hydration**:
   - `CaptureStore::open_sqlite(path, policy)` unifies database connection, migration execution, store construction, and complete repository hydration.
   - Hydration reconstructs in-memory lookup indices and strictly asserts referential integrity:
     $$\text{session.flow\_ids} \subseteq \text{flows.keys()}$$
     If any invalid reference or corrupted state is detected, hydration fails immediately rather than constructing inconsistent runtime state.
4. **Canonical `CaptureStoreSnapshot`**:
   - `CaptureStore::snapshot(&self)` creates an order-independent canonical representation across all six persistent entities for deterministic restart verification (`before_snapshot == after_snapshot`).
5. **Bounded-Work Hostile Traffic Invariant**:
   - All protocol dissectors enforce strict loop bounds (DNS compression jumps $\le 16$, TLS extensions $\le 64$) and monotonic reader advancement to ensure zero panics, finite work, and bounded memory consumption under hostile input.

## Consequences
- Guarantees crash safety, ACID compliance, and zero data loss on unexpected process restart.
- Provides predictable memory bounding through auto-eviction while preserving referenced finding evidence.
- Allows presentation projections and analytics to hydrate seamlessly from SQLite without re-running protocol dissectors.
