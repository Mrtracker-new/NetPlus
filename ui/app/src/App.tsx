// The application shell: slim icon rail, a floating glass header, the active
// screen, and a right context rail. Beginner/Intermediate/Expert is
// a global control here, with per-item escape hatches living inside the screens
//Light neumorphic is the default look; a theme toggle flips to
// the original deep-observatory dark (tokens.css [data-theme="dark"]).

import { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectionDepth, Interface as InterfaceDto } from "@netpulse/contract";
import { API_VERSION } from "@netpulse/contract";
import { changeLanguage, type Language } from "./i18n";
import { DisclosureProvider, useDisclosure, DEPTHS } from "./modes/DisclosureContext";
import { useTheme } from "./modes/useTheme";
import { useLiveData } from "./state/useLiveData";
import { useStore } from "./state/store";
import { command, query } from "./ipc";
import { Icon, type IconName } from "./icons";
import { humanBytes, primaryHostName } from "@netpulse/viz";
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
import { EvidenceNavigationProvider, useEvidenceNavigation, type Screen } from "./context/EvidenceNavigationContext";

type NavItemDef = {
  icon: IconName;
  labelKey: string;
};

const NAV_ITEMS: Record<Screen, NavItemDef> = {
  dashboard: { icon: "dashboard", labelKey: "navigation.dashboard" },
  journey: { icon: "journey", labelKey: "navigation.journey" },
  timeline: { icon: "timeline", labelKey: "navigation.timeline" },
  monitoring: { icon: "monitoring", labelKey: "navigation.monitoring" },
  apps: { icon: "apps", labelKey: "navigation.apps" },
  diagnostics: { icon: "diagnostics", labelKey: "navigation.diagnostics" },
  sandbox: { icon: "sandbox", labelKey: "navigation.sandbox" },
  fleet: { icon: "fleet", labelKey: "navigation.fleet" },
  compare: { icon: "compare", labelKey: "navigation.compare" },
  security: { icon: "security", labelKey: "navigation.security" },
  assistant: { icon: "assistant", labelKey: "navigation.assistant" },
  learn: { icon: "learn", labelKey: "navigation.learn" },
  explorer: { icon: "explorer", labelKey: "navigation.explorer" },
  recordings: { icon: "recordings", labelKey: "navigation.recordings" },
  replay: { icon: "replay", labelKey: "navigation.replay" },
  export: { icon: "export", labelKey: "navigation.export" },
  plugins: { icon: "plugins", labelKey: "navigation.plugins" },
};

type NavGroupDef = {
  id: string;
  labelKey: string;
  itemIds: readonly Screen[];
};

const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: "observe",
    labelKey: "nav_groups.observe",
    itemIds: ["dashboard", "journey", "timeline", "monitoring", "apps"],
  },
  {
    id: "analyze",
    labelKey: "nav_groups.analyze",
    itemIds: ["diagnostics", "sandbox", "fleet", "compare", "security", "assistant"],
  },
  {
    id: "learn",
    labelKey: "nav_groups.learn",
    itemIds: ["learn", "explorer"],
  },
  {
    id: "lifecycle",
    labelKey: "nav_groups.lifecycle",
    itemIds: ["recordings", "replay", "export", "plugins"],
  },
] as const;

function ModeSwitch() {
  const { depth, setDepth } = useDisclosure();
  return (
    <div className="np-modes" role="radiogroup" aria-label="Disclosure mode">
      {DEPTHS.map((d: ProjectionDepth) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === depth}
          title={d}
          className={d === depth ? "np-mode np-mode--active" : "np-mode"}
          onClick={() => setDepth(d)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

// The live-capture control and its honest, always-visible state (: a
// capture indicator is mandatory). Observe-only: this starts/stops a read-only
// frame stream, never touching traffic. The picker chooses an
// adapter; id 0 = "Default adapter", which the platform backend resolves.
function CaptureControl({ onAnnounce }: { onAnnounce?: (msg: string) => void }) {
  const { t } = useTranslation("common");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interfaces, setInterfaces] = useState<InterfaceDto[]>([]);
  const [ifaceId, setIfaceId] = useState(0);

  // Enumerate adapters once on mount. Absent a backend the list is empty and only
  // "Default adapter" is offered — the real error surfaces on Start.
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
        onAnnounce?.(t("capture.stopped_announcement"));
        await command({ kind: "stopCapture", iface_id: ifaceId });
        setRunning(false);
      } else {
        onAnnounce?.(t("capture.capturing_announcement"));
        await command({ kind: "startCapture", iface_id: ifaceId });
        setRunning(true);
      }
    } catch (e) {
      // Fail honestly — Npcap missing, no admin, or browser preview.
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
        aria-label={t("capture.select_adapter")}
        onChange={(e) => setIfaceId(Number(e.target.value))}
      >
        <option value={0}>{t("capture.default_adapter")}</option>
        {interfaces.map((i) => (
          <option key={i.id} value={i.id}>
            {i.description ?? i.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-pressed={running}
        aria-live="polite"
        className={running ? "np-btn np-capture__btn--live" : "np-btn np-btn--primary"}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? "…" : running ? t("actions.stop_capture") : t("actions.start_capture")}
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
      type="button"
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
      type="button"
      className="np-iconbtn np-lang-toggle"
      onClick={toggleLanguage}
      aria-label="Switch Language"
      title={`Language: ${currentLang.toUpperCase()}`}
    >
      {currentLang.toUpperCase()}
    </button>
  );
}

function CapabilityCard() {
  const { t } = useTranslation("common");
  const [handshake, setHandshake] = useState<{
    apiVersion: number;
    hostVersion: number;
    compatible: boolean;
  }>({
    apiVersion: API_VERSION,
    hostVersion: API_VERSION,
    compatible: true,
  });

  const [capabilities, setCapabilities] = useState<string[]>([
    "Live Capture",
    "Flow Attribution",
    "TLS Dissection",
    "Security Engine",
    "Replay Engine",
  ]);

  useEffect(() => {
    let cancelled = false;

    query({ kind: "handshake", client_version: API_VERSION })
      .then((res) => {
        if (!cancelled && res.kind === "handshake") {
          setHandshake({
            apiVersion: API_VERSION,
            hostVersion: res.handshake.host_version,
            compatible: res.handshake.compatible,
          });
        }
      })
      .catch(() => {
        /* Keep fallback version info in preview mode */
      });

    query({ kind: "getCapabilityRegistry" })
      .then((res) => {
        if (!cancelled && res.kind === "capabilityRegistry" && res.registry) {
          const list = Array.isArray(res.registry.capabilities)
            ? res.registry.capabilities
            : Array.isArray(res.registry)
            ? res.registry
            : capabilities;
          setCapabilities(list);
        }
      })
      .catch(() => {
        /* Keep fallback capabilities in preview mode */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="np-rail-card np-capability-card">
      <h2 className="np-rail-card__title">{t("rail.capability_registry")}</h2>
      <ul className="np-rail-list" style={{ marginBottom: "0.5rem" }}>
        <li>
          API Version
          <span className="np-rail-list__val">v{handshake.apiVersion}</span>
        </li>
        <li>
          Engine Version
          <span className="np-rail-list__val">v{handshake.hostVersion}</span>
        </li>
        <li>
          Status
          <span
            className="np-rail-list__val"
            style={{
              color: handshake.compatible ? "#10b981" : "#ef4444",
              fontWeight: 500,
            }}
          >
            {handshake.compatible ? "Compatible" : "Incompatible"}
          </span>
        </li>
      </ul>
      <div
        className="np-rail-card__title"
        style={{ fontSize: "0.75rem", marginBottom: "0.4rem", textTransform: "uppercase" }}
      >
        Capabilities ({capabilities.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {capabilities.map((cap, i) => (
          <span
            key={i}
            className="np-evidence np-evidence--static"
            style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
          >
            {cap}
          </span>
        ))}
      </div>
    </section>
  );
}

// The right context rail — real NetPulse content only (docs honesty: no invented
// users/resources). Capture status, top observed hosts, and quick controls.
function RightRail() {
  const { t } = useTranslation("common");
  const { monitor, feed } = useStore();
  const hosts = monitor
    ? [...monitor.by_host.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6)
    : [];
  const totalFlows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;

  return (
    <aside className="np-rail-right" aria-label="Context">
      <section className="np-rail-card">
        <h2 className="np-rail-card__title">{t("rail.this_session")}</h2>
        <ul className="np-rail-list">
          <li>
            {t("rail.hosts_observed")}
            <span className="np-rail-list__val">{monitor?.by_host.rows.length ?? 0}</span>
          </li>
          <li>
            {t("rail.active_flows")}
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
          <li>
            {t("rail.narrative_cards")}
            <span className="np-rail-list__val">{feed.length}</span>
          </li>
          <li>
            {t("rail.capture_drops")}
            <span className="np-rail-list__val">{monitor?.capture_drops ?? 0}</span>
          </li>
        </ul>
      </section>

      <section className="np-rail-card">
        <h2 className="np-rail-card__title">{t("rail.top_hosts")}</h2>
        {hosts.length === 0 ? (
          <p className="np-cons__hint">{t("rail.quiet_no_hosts")}</p>
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
        <h2 className="np-rail-card__title">{t("rail.view_density")}</h2>
        <ModeSwitch />
      </section>

      <CapabilityCard />
    </aside>
  );
}

function Shell() {
  const { screen, setScreen } = useEvidenceNavigation();
  const { t } = useTranslation("common");
  const [announcement, setAnnouncement] = useState("");

  useLiveData();
  const { depth } = useDisclosure();

  return (
    <div className="np-app" data-depth={depth}>
      {/* Top-level dedicated ARIA Live Region for accessibility announcements */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <nav className="np-nav" aria-label="Primary navigation">
        <div className="np-nav__brand" title="NetPulse">
          <Icon name="brand" />
        </div>
        {NAV_GROUPS.map((group, groupIdx) => (
          <section
            key={group.id}
            className="np-nav__group"
            role="group"
            aria-labelledby={`nav-group-${group.id}`}
          >
            {groupIdx > 0 && <hr className="np-nav__divider" aria-hidden="true" />}
            <h2 id={`nav-group-${group.id}`} className="np-nav__group-label" title={t(group.labelKey as any)}>
              {t(group.labelKey as any)}
            </h2>
            <ul className="np-nav__items" role="list">
              {group.itemIds.map((id) => {
                const item = NAV_ITEMS[id];
                const label = t(item.labelKey as any);
                return (
                  <li key={id}>
                    <button
                      title={label}
                      data-label={label}
                      aria-label={label}
                      aria-current={id === screen ? "page" : undefined}
                      className={id === screen ? "np-nav__item np-nav__item--active" : "np-nav__item"}
                      onClick={() => setScreen(id)}
                    >
                      <Icon name={item.icon} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="np-main">
        <header className="np-header">
          <span className="np-brand">NetPulse</span>
          <span className="np-screen-indicator" role="status" aria-label={t(`screen_titles.${screen}` as any)}>
            {t(`screen_titles.${screen}` as any)}
          </span>
          <span className="np-header__spacer" />
          <CaptureControl onAnnounce={setAnnouncement} />
          <ThemeToggle />
          <LanguageToggle />
        </header>
        {/* Force remount so entry animation runs on navigation */}
        <main key={screen}>
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

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    console.error("NetPulse UI Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", color: "#ef4444", background: "var(--np-bg, #0b1019)", minHeight: "100vh" }}>
          <h2>⚠️ Something went wrong</h2>
          <pre style={{ background: "rgba(255,255,255,0.05)", padding: "1rem", borderRadius: "8px", color: "#f59e0b" }}>
            {this.state.error}
          </pre>
          <button
            className="np-btn np-btn--primary"
            onClick={() => this.setState({ hasError: false, error: "" })}
            style={{ marginTop: "1rem" }}
          >
            Retry Screen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

