# `@netpulse/contract`

Auto-generated TypeScript DTO definitions matching the `netpulse-api` Rust crate (v4 contract).

---

## Contract Synchronization & Drift Prevention

This package acts as the single versioned contract boundary between the Rust backend (`netpulse-engine`) and the React frontend (`ui/app`).

### Automatic Codegen
The TypeScript types in `src/index.ts` are generated directly from Rust DTO definitions using `ts-rs`:

```sh
# Regenerate TypeScript contract files from Rust source of truth:
cargo test -p netpulse-api -- --ignored write_contract
```

### Type Verification
Run TypeScript type validation across the generated contract:
```sh
pnpm --filter @netpulse/contract typecheck
```

CI enforces contract synchronization by failing if the Rust DTO definitions and the committed TypeScript types disagree. **Do not hand-edit `src/index.ts`.**
