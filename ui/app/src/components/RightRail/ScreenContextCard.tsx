import { useTranslation } from "react-i18next";
import { useEvidenceNavigation, type Screen } from "../../context/EvidenceNavigationContext";
import { useStore } from "../../state/store";
import { useSidebar } from "./RightRailContext";
import { GeoContextCard } from "./GeoContextCard";
import { Icon } from "../../icons";

export interface ContextTelemetry {
  label: string;
  value: string | number;
}

export interface ScreenContextDescriptor {
  titleKey: string;
  defaultTitle: string;
  summaryKey: string;
  defaultSummary: string;
  badge?: string;
  getTelemetry?: (monitor: ReturnType<typeof useStore>["monitor"], feedLength: number) => ContextTelemetry[];
}

export const SCREEN_CONTEXTS: Record<Screen, ScreenContextDescriptor> = {
  dashboard: {
    titleKey: "screen_titles.dashboard",
    defaultTitle: "Dashboard Telemetry",
    summaryKey: "screen_summaries.dashboard",
    defaultSummary: "Real-time observation of active network traffic, hosts, and protocol feeds.",
    badge: "Live Stream",
    getTelemetry: (monitor, feedLength) => [
      { label: "Active Flows", value: monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0 },
      { label: "Observed Hosts", value: monitor?.by_host.rows.length ?? 0 },
      { label: "Narratives", value: feedLength },
    ],
  },
  journey: {
    titleKey: "screen_titles.journey",
    defaultTitle: "User Journey & Sessions",
    summaryKey: "screen_summaries.journey",
    defaultSummary: "End-to-end trace of client connection stages, TLS handshakes, and application lifecycle.",
    badge: "Session Trace",
  },
  timeline: {
    titleKey: "screen_titles.timeline",
    defaultTitle: "Packet Timeline",
    summaryKey: "screen_summaries.timeline",
    defaultSummary: "Chronological sequence of captured network frames, ribbon markers, and protocol events.",
    badge: "Time Series",
  },
  monitoring: {
    titleKey: "screen_titles.monitoring",
    defaultTitle: "Real-time Telemetry",
    summaryKey: "screen_summaries.monitoring",
    defaultSummary: "Live protocol performance, throughput metrics, loss indicators, and bandwidth trends.",
    badge: "Active Telemetry",
    getTelemetry: (monitor) => [
      { label: "Active Flows", value: monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0 },
      { label: "Protocols", value: monitor?.by_protocol.rows.length ?? 0 },
    ],
  },
  apps: {
    titleKey: "screen_titles.apps",
    defaultTitle: "Application Inspection",
    summaryKey: "screen_summaries.apps",
    defaultSummary: "Process-level attribution, network socket breakdown, and app flow profiling.",
    badge: "App Attribution",
  },
  security: {
    titleKey: "screen_titles.security",
    defaultTitle: "Threat & Posture",
    summaryKey: "screen_summaries.security",
    defaultSummary: "Inspection of active threats, certificate anomalies, and security findings.",
    badge: "Security Engine",
    getTelemetry: (monitor) => [
      { label: "Loss Indicators", value: monitor?.network_loss_indicators ?? 0 },
      { label: "Capture Drops", value: monitor?.capture_drops ?? 0 },
    ],
  },
  assistant: {
    titleKey: "screen_titles.assistant",
    defaultTitle: "AI Copilot Assistant",
    summaryKey: "screen_summaries.assistant",
    defaultSummary: "Natural language query engine, automated diagnostics, and evidence-backed explanations.",
    badge: "AI Copilot",
  },
  learn: {
    titleKey: "screen_titles.learn",
    defaultTitle: "Learning & Knowledge",
    summaryKey: "screen_summaries.learn",
    defaultSummary: "Interactive protocol guides, network analysis concepts, and hands-on tutorials.",
    badge: "Tutorials",
  },
  explorer: {
    titleKey: "screen_titles.explorer",
    defaultTitle: "Evidence Explorer",
    summaryKey: "screen_summaries.explorer",
    defaultSummary: "Deep-dive search across network frames, packet payloads, and forensic metadata.",
    badge: "Forensics",
  },
  recordings: {
    titleKey: "screen_titles.recordings",
    defaultTitle: "Capture Recordings",
    summaryKey: "screen_summaries.recordings",
    defaultSummary: "PCAP recording management, storage quotas, and automated session dumps.",
    badge: "PCAP Storage",
  },
  replay: {
    titleKey: "screen_titles.replay",
    defaultTitle: "Traffic Replay Engine",
    summaryKey: "screen_summaries.replay",
    defaultSummary: "Stateful packet playback, stress simulation, and regression testing.",
    badge: "Replay Engine",
  },
  export: {
    titleKey: "screen_titles.export",
    defaultTitle: "Export & Sanitization",
    summaryKey: "screen_summaries.export",
    defaultSummary: "Anonymized report generation, payload stripping, and evidence export formatting.",
    badge: "Sanitizer",
  },
  plugins: {
    titleKey: "screen_titles.plugins",
    defaultTitle: "Plugin Registry",
    summaryKey: "screen_summaries.plugins",
    defaultSummary: "Dissection extension modules, custom decoders, and third-party integrations.",
    badge: "Extensions",
  },
  diagnostics: {
    titleKey: "screen_titles.diagnostics",
    defaultTitle: "System Probes & Ping",
    summaryKey: "screen_summaries.diagnostics",
    defaultSummary: "Synthetic ping probes, latency distribution, and jitter diagnostics.",
    badge: "Diagnostic Tool",
  },
  sandbox: {
    titleKey: "screen_titles.sandbox",
    defaultTitle: "Protocol Sandbox",
    summaryKey: "screen_summaries.sandbox",
    defaultSummary: "Packet construction, byte manipulation, and rule verification testing.",
    badge: "Testing Rig",
  },
  fleet: {
    titleKey: "screen_titles.fleet",
    defaultTitle: "Fleet Nodes",
    summaryKey: "screen_summaries.fleet",
    defaultSummary: "Distributed capture node synchronization and cluster status.",
    badge: "Multi-Node",
  },
  compare: {
    titleKey: "screen_titles.compare",
    defaultTitle: "Session Diff",
    summaryKey: "screen_summaries.compare",
    defaultSummary: "Side-by-side comparison of baseline and target capture sessions.",
    badge: "Diff Tool",
  },
};

export const FALLBACK_DESCRIPTOR: ScreenContextDescriptor = {
  titleKey: "screen_titles.unknown",
  defaultTitle: "Contextual Guidance",
  summaryKey: "screen_summaries.unknown",
  defaultSummary: "No contextual guidance available for this screen.",
  badge: "General",
};

export function ScreenContextCard() {
  const { screen, setScreen } = useEvidenceNavigation();
  const { t } = useTranslation("common");
  const { monitor, feed } = useStore();
  const { selectedEntity, setSelectedEntity } = useSidebar();

  if (selectedEntity) {
    return <GeoContextCard entity={selectedEntity} onClearSelection={() => setSelectedEntity(null)} />;
  }

  const descriptor = SCREEN_CONTEXTS[screen] ?? FALLBACK_DESCRIPTOR;
  const title = t(descriptor.titleKey as any, descriptor.defaultTitle);
  const summary = t(descriptor.summaryKey as any, descriptor.defaultSummary);
  const telemetry = descriptor.getTelemetry ? descriptor.getTelemetry(monitor, feed.length) : undefined;

  return (
    <section className="np-rail-card np-screen-context-card">
      <div className="np-screen-context__header">
        <h2 className="np-rail-card__title">{title}</h2>
        {descriptor.badge && <span className="np-badge np-badge--accent">{descriptor.badge}</span>}
      </div>
      <p className="np-screen-context__summary">{summary}</p>
      {telemetry && telemetry.length > 0 && (
        <ul className="np-rail-list np-screen-context__telemetry" style={{ marginTop: "0.5rem" }}>
          {telemetry.map((tItem, idx) => (
            <li key={idx}>
              <span>{tItem.label}</span>
              <span className="np-rail-list__val">{tItem.value}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="np-screen-context__actions" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="np-btn np-btn--secondary np-btn--sm"
          onClick={() => setScreen("explorer")}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
        >
          <Icon name="explorer" style={{ width: "14px", height: "14px" }} />
          Inspect Evidence Explorer
        </button>
      </div>
    </section>
  );
}
