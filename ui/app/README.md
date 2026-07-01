# @netpulse/app

The application: routes, screens, and Beginner/Intermediate/Expert mode
switching (`docs/0-foundation/04_Project_Structure.md` §4).

Planned structure (Phase 2):

```
src/
├── screens/   Dashboard, Timeline, Explorer, Security, Learn, Replay…
├── state/     normalized store, stream subscriptions (renders deltas, not snapshots)
└── modes/     Beginner/Intermediate/Expert progressive-disclosure logic
```

**Status: foundation stub.** No build wiring yet — Phase 2 (`docs/09`–`16`).
