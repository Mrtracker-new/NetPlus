# `@netpulse/components`

Shared, disclosure-aware React UI components used across NetPulse screens.

---

## Component Philosophy

Every domain component in `@netpulse/components` accepts a progressive disclosure level (`Beginner`, `Intermediate`, `Expert`) and adjusts its rendered detail accordingly:

- **Beginner**: High-level plain-language narrative summary, visual icons, and status badges.
- **Intermediate**: Adds key metric breakdowns, protocol handshakes, and process attributions.
- **Expert**: Dense technical presentation with hex viewer snippets, raw header flags, packet timing deltas, and flow state machine details.

---

## Key Components

- **`NarrativeCard`**: Glass card presenting reconstructed network stories with severity badges and drill-down evidence chips.
- **`EvidenceChip`**: Interactive badge linking a findings summary directly to underlying packet/flow data.
- **`SeverityGlyph`**: Calibrated severity indicator matching standard design tokens.
- **`DisclosureToggle`**: Segmented control enabling smooth switching between disclosure levels.
