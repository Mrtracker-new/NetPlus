# `@netpulse/design-system`

The single source of truth for NetPulse's visual identity, design tokens, dark mode theme, typography scale, protocol color mappings, and global CSS utilities.

---

## Design System Principles — "Signal" Aesthetic

- **Theme Palette**: Deep dark background (`#0B0E14`), elevated surface cards (`#121722`), pulse cyan accent (`#2FE0D6`), and indigo sub-accents (`#6366F1`).
- **Typography**: Inter/Geist for interface headings and body text; JetBrains Mono / Geist Mono for technical telemetry (hex data, IP addresses, ports, timing metrics).
- **Calm Semantics**: Non-alarmist status colors (quiet green for normal traffic, desaturated rose for findings, amber for notable events).
- **Protocol Iconography**: Uniform color and glyph mappings for protocol badges (DNS, HTTP, TLS, TCP, UDP, QUIC).

---

## Workspace Usage

Import design system styles in application entrypoints (`main.tsx`):

```tsx
import '@netpulse/design-system/styles.css';
```

All UI packages and application screens consume predefined design tokens and utility classes from `@netpulse/design-system` to maintain visual consistency across all progressive disclosure views.
