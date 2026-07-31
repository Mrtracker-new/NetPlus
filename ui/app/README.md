# `@netpulse/app`

The primary single-page React application for NetPulse, hosting the routing framework, screen views, state management store, and progressive disclosure controls.

---

## Directory Structure

```
src/
├── screens/       Page components (Dashboard, Timeline, Security, Apps, Learn, Explorer, Plugins)
├── state/         Zustand/React state store for live narrative cards, monitor metrics, and settings
├── modes/         Progressive disclosure logic (Beginner, Intermediate, Expert mode filtering)
├── hooks/         Custom hooks for live backend streaming, IPC queries, and window events
├── viz/           Application-level visualizers and flow canvases
├── i18n/          Internationalization and localization dictionary keys
├── ipc.ts         Tauri IPC client wrapper calling netpulse-api commands and queries
├── icons.tsx      SVG icon set for network protocols and UI actions
├── App.tsx        Root application component with sidebar navigation and top bar
└── main.tsx       Application entrypoint loading global CSS tokens and React root
```

---

## Developer Usage

### Development Server
Run the Vite development server with hot-module reloading:
```sh
pnpm --filter @netpulse/app dev
```

### Typecheck & Lint
Validate TypeScript types across the app:
```sh
pnpm --filter @netpulse/app typecheck
```

---

## State & Data Flow

- The app connects to the Rust `netpulse-engine` backend via Tauri v2 IPC (`ipc.ts`).
- Telemetry updates (live flows, throughput, narrative cards, security findings) stream into `state/store.ts`.
- Components consume state through custom hooks and dynamically adjust rendering depth based on the active progressive disclosure level.
