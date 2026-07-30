// The application shell: slim icon rail, a floating glass header, the active
// screen, and a right context rail (docs/09 §4). Beginner/Intermediate/Expert is
// a global control here, with per-item escape hatches living inside the screens
// (docs/09 §6.3). Light neumorphic is the default look; a theme toggle flips to
// the original deep-observatory dark (tokens.css [data-theme="dark"]).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectionDepth, Interface as InterfaceDto } from "@netpulse/contract";
import { changeLanguage, type Language } from "./i18n";
import { DisclosureProvider, useDisclosure, DEPTHS } from "./modes/DisclosureContext";
import { useTheme } from "./modes/useTheme";
import { useLiveData } from "./state/useLiveData";
import { useStore } from "./state/store";
import { command, query } from "./ipc";
import { Icon, type IconName } from "./icons";
import { humanBytes, primaryHostName } from "./viz";
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
import { DiagnosticsScreen } from "./screens/Diagnostics";
import { ProtocolSandboxScreen } from "./screens/ProtocolSandbox";
import { FleetScreen } from "./screens/Fleet";
import { SessionDiffScreen } from "./screens/SessionDiff";

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
  | "plugins"
  | "diagnostics"
  | "sandbox"
  | "fleet"
  | "compare";

const NAV: Array<{ id: Screen; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "journey", label: "Journey", icon: "journey" },
  { id: "timeline", label: "Timeline", icon: "timeline" },
  { id: "monitoring", label: "Monitor", icon: "monitoring" },
  { id: "apps", label: "Apps", icon: "apps" },
  { id: "diagnostics", label: "Diagnostics", icon: "security" },
  { id: "sandbox", label: "Sandbox", icon: "explorer" },
  { id: "fleet", label: "Fleet", icon: "apps" },
  { id: "compare", label: "Compare", icon: "timeline" },
  { id: "security", label: "Security", icon: "security" },
  { id: "assistant", label: "Assistant", icon: "assistant" },
  { id: "learn", label: "Learn", icon: "learn" },
  { id: "explorer", label: "Explorer", icon: "explorer" },
  // Phase 5 lifecycle surfaces (docs/21–24).
  { id: "recordings", label: "Recordings", icon: "recordings" },
  { id: "replay", label: "Replay", icon: "replay" },
  { id: "export", label: "Export", icon: "export" },
  { id: "plugins", label: "Plugins", icon: "plugins" },
];

const SCREEN_TITLE: Record<Screen, string> = {
  dashboard: "Dashboard",
  journey: "Page Journey",
  timeline: "Timeline",
  monitoring: "Monitoring",
  apps: "Applications",
  security: "Security",
  assistant: "Assistant",
  learn: "Learn",
  explorer: "Explorer",
  recordings: "Recordings",
  replay: "Replay",
  export: "Export",
  plugins: "Plugins",
  diagnostics: "Diagnostics",
  sandbox: "Protocol Sandbox",
  fleet: "Fleet",
  compare: "Session Compare",
};

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

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      className="np-iconbtn"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

function LanguageToggle() {
  const { i18n } = useTranslation();
  const rawLang = (i18n.language || "en").split("-")[0] || "en";
  const currentLang: Language = rawLang === "es" ? "es" : "en";

  function toggleLanguage() {
    const nextLang: Language = currentLang === "en" ? "es" : "en";
    void changeLanguage(i18n, nextLang);
  }

  return (
    <button
      className="np-iconbtn"
      onClick={toggleLanguage}
      aria-label="Switch Language"
      title={`Language: ${currentLang.toUpperCase()}`}
      style={{ fontWeight: 600, fontSize: "0.85rem", width: "auto", padding: "0 6px" }}
    >
      {currentLang.toUpperCase()}
    </button>
  );
}

// The right context rail — real NetPulse content only (docs honesty: no invented
// users/resources). Capture status, the top observed hosts, and quick controls.
function RightRail() {
  const { monitor, feed } = useStore();
  const hosts = monitor
    ? [...monitor.by_host.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6)
    : [];
  const totalFlows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;

  return (
    <aside className="np-rail-right" aria-label="Context">
      <section className="np-rail-card">
        <h2 className="np-rail-card__title">This session</h2>
        <ul className="np-rail-list">
          <li>
            Hosts observed
            <span className="np-rail-list__val">{monitor?.by_host.rows.length ?? 0}</span>
          </li>
          <li>
            Active flows
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
          <li>
            Narrative cards
            <span className="np-rail-list__val">{feed.length}</span>
          </li>
          <li>
            Capture drops
            <span className="np-rail-list__val">{monitor?.capture_drops ?? 0}</span>
          </li>
        </ul>
      </section>

      <section className="np-rail-card">
        <h2 className="np-rail-card__title">Top hosts</h2>
        {hosts.length === 0 ? (
          <p className="np-cons__hint">Quiet — no hosts yet.</p>
        ) : (
          <ul className="np-rail-list">
            {hosts.map((h) => {
              const nm = primaryHostName(h);
              return (
                <li key={h.label}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    // The raw IP is always available on hover, even when a name
                    // is foregrounded — the address stays the source of truth.
                    title={nm ? `${nm.name} · ${h.label}` : h.label}
                  >
                    {nm ? nm.name : h.label}
                  </span>
                  <span className="np-rail-list__val">{humanBytes(h.bytes)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="np-rail-card">
        <h2 className="np-rail-card__title">View density</h2>
        <ModeSwitch />
      </section>
    </aside>
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
      <nav className="np-nav" aria-label="Primary">
        <div className="np-nav__brand" title="NetPulse">
          <Icon name="brand" />
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            data-label={item.label}
            aria-label={item.label}
            aria-current={item.id === screen ? "page" : undefined}
            className={item.id === screen ? "np-nav__item np-nav__item--active" : "np-nav__item"}
            onClick={() => setScreen(item.id)}
          >
            <Icon name={item.icon} />
          </button>
        ))}
      </nav>

      <div className="np-main">
        <header className="np-header">
          <span className="np-brand">NetPulse</span>
          <span className="np-search" aria-hidden="true">
            <Icon name="search" />
            {SCREEN_TITLE[screen]}
          </span>
          <span className="np-header__spacer" />
          <CaptureControl />
          <ThemeToggle />
          <LanguageToggle />
        </header>
        <main>
          {screen === "dashboard" && <Dashboard />}
          {screen === "journey" && <Journey />}
          {screen === "timeline" && <Timeline />}
          {screen === "monitoring" && <Monitoring />}
          {screen === "apps" && <Apps />}
          {screen === "diagnostics" && <DiagnosticsScreen />}
          {screen === "sandbox" && <ProtocolSandboxScreen />}
          {screen === "fleet" && <FleetScreen />}
          {screen === "compare" && <SessionDiffScreen />}
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

      <RightRail />
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
