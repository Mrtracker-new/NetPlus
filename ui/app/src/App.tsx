// The application shell: left nav, the disclosure-mode switch, and the active
// screen (docs/09 §4). Beginner/Intermediate/Expert is a global control here,
// with per-item escape hatches living inside the screens (docs/09 §6.3).

import { useState } from "react";
import type { ProjectionDepth } from "@netpulse/contract";
import { DisclosureProvider, useDisclosure, DEPTHS } from "./modes/DisclosureContext";
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

function Shell() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  return (
    <div className="np-app">
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
