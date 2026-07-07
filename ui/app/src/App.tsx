// The application shell: left nav, the disclosure-mode switch, and the active
// screen (docs/09 §4). Beginner/Intermediate/Expert is a global control here,
// with per-item escape hatches living inside the screens (docs/09 §6.3).

import { useEffect, useState } from "react";
import type { ProjectionDepth, Interface as InterfaceDto } from "@netpulse/contract";
import { DisclosureProvider, useDisclosure, DEPTHS } from "./modes/DisclosureContext";
import { useLiveData } from "./state/useLiveData";
import { command, query } from "./ipc";
import { Dashboard } from "./screens/Dashboard";
import { Timeline } from "./screens/Timeline";
import { Monitoring } from "./screens/Monitoring";
import { Apps } from "./screens/Apps";
import { Journey } from "./screens/Journey";
import { Learn } from "./screens/Learn";
import { Explorer } from "./screens/Explorer";
import { Security } from "./screens/Security";
import { Assistant } from "./screens/Assistant";
import { Recordings } from "./screens/Recordings";
import { Replay } from "./screens/Replay";
import { Export } from "./screens/Export";
import { Plugins } from "./screens/Plugins";

type Screen =
  | "dashboard"
  | "journey"
  | "timeline"
  | "monitoring"
  | "apps"
  | "security"
  | "assistant"
  | "learn"
  | "explorer"
  | "recordings"
  | "replay"
  | "export"
  | "plugins";

const NAV: Array<{ id: Screen; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "journey", label: "Journey" },
  { id: "timeline", label: "Timeline" },
  { id: "monitoring", label: "Monitor" },
  { id: "apps", label: "Apps" },
  { id: "security", label: "Security" },
  { id: "assistant", label: "Assistant" },
  { id: "learn", label: "Learn" },
  { id: "explorer", label: "Explorer" },
  // Phase 5 lifecycle surfaces (docs/21–24).
  { id: "recordings", label: "Recordings" },
  { id: "replay", label: "Replay" },
  { id: "export", label: "Export" },
  { id: "plugins", label: "Plugins" },
];

function ModeSwitch() {
  const { depth, setDepth } = useDisclosure();
  return (
    <div className="np-modes" role="radiogroup" aria-label="Disclosure mode">
      {DEPTHS.map((d: ProjectionDepth) => (
        <button
          key={d}
          role="radio"
          aria-checked={d === depth}
          className={d === depth ? "np-mode np-mode--active" : "np-mode"}
          onClick={() => setDepth(d)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

// The live-capture control and its honest, always-visible state (docs/17 §8: a
// capture indicator is mandatory). Observe-only: this starts/stops a read-only
// frame stream, never touching traffic (docs/01 X1). The picker chooses an
// adapter; id 0 = "Default adapter", which the platform backend resolves.
function CaptureControl() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interfaces, setInterfaces] = useState<InterfaceDto[]>([]);
  const [ifaceId, setIfaceId] = useState(0);

  // Enumerate adapters once on mount. Absent a backend the list is empty and only
  // "Default adapter" is offered — the real error surfaces on Start (docs/02 §11).
  useEffect(() => {
    let cancelled = false;
    query({ kind: "interfaces" })
      .then((res) => {
        if (!cancelled && res.kind === "interfaces") setInterfaces(res.interfaces);
      })
      .catch(() => {
        /* no backend (browser preview / Npcap absent) — keep the default option */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (running) {
        await command({ kind: "stopCapture", iface_id: ifaceId });
        setRunning(false);
      } else {
        await command({ kind: "startCapture", iface_id: ifaceId });
        setRunning(true);
      }
    } catch (e) {
      // Fail honestly — Npcap missing, no admin, or browser preview (docs/02 §11).
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="np-capture" title={error ?? undefined}>
      {running && <span className="np-capture__dot" aria-hidden="true" />}
      <select
        className="np-capture__iface"
        value={ifaceId}
        disabled={running || busy}
        aria-label="Capture interface"
        onChange={(e) => setIfaceId(Number(e.target.value))}
      >
        <option value={0}>Default adapter</option>
        {interfaces.map((i) => (
          <option key={i.id} value={i.id}>
            {i.description ?? i.name}
          </option>
        ))}
      </select>
      <button
        className={running ? "np-btn np-capture__btn--live" : "np-btn np-btn--primary"}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? "…" : running ? "Stop capture" : "Start capture"}
      </button>
      {error && (
        <span className="np-capture__err" role="status" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function Shell() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  // The data pump: feeds the client store from the engine (feed + monitor), and
  // subscribes to live capture deltas when running in Tauri.
  useLiveData();
  // Disclosure mode drives visual density via the [data-depth] CSS hook
  // (docs/09 §6.3): beginners get roomier type, experts get compact data.
  const { depth } = useDisclosure();
  return (
    <div className="np-app" data-depth={depth}>
      <nav className="np-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={item.id === screen ? "np-nav__item np-nav__item--active" : "np-nav__item"}
            onClick={() => setScreen(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="np-main">
        <header className="np-header">
          <span className="np-brand">NetPulse</span>
          <CaptureControl />
          <ModeSwitch />
        </header>
        <main>
          {screen === "dashboard" && <Dashboard />}
          {screen === "journey" && <Journey />}
          {screen === "timeline" && <Timeline />}
          {screen === "monitoring" && <Monitoring />}
          {screen === "apps" && <Apps />}
          {screen === "security" && <Security />}
          {screen === "assistant" && <Assistant />}
          {screen === "learn" && <Learn />}
          {screen === "explorer" && <Explorer />}
          {screen === "recordings" && <Recordings />}
          {screen === "replay" && <Replay />}
          {screen === "export" && <Export />}
          {screen === "plugins" && <Plugins />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <DisclosureProvider>
      <Shell />
    </DisclosureProvider>
  );
}
