# @netpulse/contract

**Generated from the `netpulse-api` crate — do not hand-edit.**

This package holds the TypeScript view of the Query/Stream/Command message
schema (`docs/0-foundation/02_System_Architecture.md` §7,
`docs/0-foundation/03_Technology_Stack.md` §7). Generating it from the Rust
source of truth guarantees the UI and engine can never disagree about the shape
of a `Flow`, `Session`, or `Finding`. A CI drift check fails the build if this
package is out of sync with `netpulse-api`.

**Status: foundation stub.** ts-rs codegen is wired once the API schema firms up.
