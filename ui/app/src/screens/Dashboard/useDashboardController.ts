import { useState, useMemo, useCallback } from "react";
import { useStore } from "../../state/store";
import { useDisclosure } from "../../modes/DisclosureContext";
import { useOptionalSidebar } from "../../components/RightRail";
import { humanBytes, type SelectedEntity } from "@netpulse/viz";
import { generateSituationSummary } from "./SummaryEngine";
import type {
  NarrativeCategory,
  HeroViewModel,
  SituationSummaryModel,
  KpiViewModel,
  HealthViewModel,
  DashboardEvent,
  VizMode,
} from "./viewModels";

export function useDashboardController() {
  const { monitor, feed, hostsHistory, flowsHistory, cardsHistory, captureSessionId, snapshotSequence } = useStore();
  const { depth, shows } = useDisclosure();
  const sidebar = useOptionalSidebar();

  // Local UI states
  const [category, setCategory] = useState<NarrativeCategory>("all");
  const [search, setSearch] = useState("");
  const [vizMode, setVizMode] = useState<VizMode>("map");
  const [localSelectedEntity, setLocalSelectedEntity] = useState<SelectedEntity | null>(null);

  const selectedEntity = sidebar ? sidebar.selectedEntity : localSelectedEntity;

  // 1. Situation Summary Model
  const situationSummaryModel: SituationSummaryModel = useMemo(() => {
    return generateSituationSummary(monitor, feed);
  }, [monitor, feed]);

  // 2. Hero View Model (State Machine directly synchronized with authoritative Situation Summary)
  const heroViewModel: HeroViewModel = useMemo(() => {
    if (situationSummaryModel.overallHealth === "finding") {
      return {
        state: "finding",
        badgeText: "Attention",
        title: situationSummaryModel.headline,
        subtitle: situationSummaryModel.explanation,
      };
    }

    if (situationSummaryModel.overallHealth === "notable") {
      return {
        state: "spike",
        badgeText: "Notable",
        title: situationSummaryModel.headline,
        subtitle: situationSummaryModel.explanation,
      };
    }

    return {
      state: "healthy",
      badgeText: "Nominal",
      title: "Network Operating Normally",
      subtitle: "Passive telemetry active. No critical anomalies detected.",
    };
  }, [situationSummaryModel]);

  // 3. KPI View Models (Strict Authoritative Rates from throughput_history & telemetry_state)
  const kpiViewModels: KpiViewModel[] = useMemo(() => {
    const hosts = monitor?.by_host.rows.length ?? 0;
    const flows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
    const bytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;

    const history = monitor?.throughput_history ?? [];
    const latestSample = history.length > 0 ? history[history.length - 1] : null;
    const telemetryState = monitor?.telemetry_state ?? "standby";

    const ingressBps = telemetryState === "active" && latestSample ? latestSample.ingress_rate_bytes_sec : 0;
    const egressBps = telemetryState === "active" && latestSample ? latestSample.egress_rate_bytes_sec : 0;

    // Truthful 4-State Telemetry Rate Mapping:
    // Active      -> live measured rate (or 0 B/s if measured zero traffic)
    // Stale       -> rate unknown due to expired telemetry: ▼ — /s (Stale)
    // Standby     -> capture not active:                   ▼ 0 B/s (Standby)
    // Unavailable -> telemetry offline / unmeasured:       ▼ — (Unavailable)
    let rateDown: string;
    let rateUp: string;
    let activityBadgeText = "Standby";
    let activityBadgeVariant: "healthy" | "quiet" | "congested" | "spike" = "quiet";

    switch (telemetryState) {
      case "active":
        rateDown = ingressBps > 0 ? `▼ ${humanBytes(ingressBps)}/s` : "▼ 0 B/s";
        rateUp = egressBps > 0 ? `▲ ${humanBytes(egressBps)}/s` : "▲ 0 B/s";
        activityBadgeText = ingressBps > 10_000_000 ? "Active" : "Nominal";
        activityBadgeVariant = "healthy";
        break;
      case "stale":
        rateDown = "▼ — /s (Stale)";
        rateUp = "▲ — /s (Stale)";
        activityBadgeText = "Stale";
        activityBadgeVariant = "congested";
        break;
      case "standby":
        rateDown = "▼ 0 B/s (Standby)";
        rateUp = "▲ 0 B/s (Standby)";
        activityBadgeText = "Standby";
        activityBadgeVariant = "quiet";
        break;
      case "unavailable":
      default:
        rateDown = "▼ — (Unavailable)";
        rateUp = "▲ — (Unavailable)";
        activityBadgeText = "Unavailable";
        activityBadgeVariant = "quiet";
        break;
    }

    const totalBps = ingressBps + egressBps;

    const sparklineActivity =
      history.length > 1
        ? history.map((s) => s.ingress_rate_bytes_sec + s.egress_rate_bytes_sec).slice(-8)
        : [];
    const sparklineHosts = hostsHistory && hostsHistory.length > 1 ? hostsHistory.slice(-8) : [];
    const sparklineFlows = flowsHistory && flowsHistory.length > 1 ? flowsHistory.slice(-8) : [];
    const sparklineCards = cardsHistory && cardsHistory.length > 1 ? cardsHistory.slice(-8) : [];

    const peakActivityBps = sparklineActivity.length > 0 ? Math.max(...sparklineActivity, totalBps) : totalBps;
    const avgActivityBps =
      sparklineActivity.length > 0
        ? Math.round(sparklineActivity.reduce((sum, v) => sum + v, 0) / sparklineActivity.length)
        : totalBps;

    const inboundRate =
      telemetryState === "active"
        ? `${humanBytes(ingressBps)}/s`
        : telemetryState === "standby"
        ? "0 B/s"
        : "—";

    const outboundRate =
      telemetryState === "active"
        ? `${humanBytes(egressBps)}/s`
        : telemetryState === "standby"
        ? "0 B/s"
        : "—";

    const peakRate =
      telemetryState === "active"
        ? `${humanBytes(peakActivityBps)}/s`
        : telemetryState === "standby"
        ? "0 B/s"
        : "—";

    const avgRate =
      telemetryState === "active"
        ? `${humanBytes(avgActivityBps)}/s`
        : telemetryState === "standby"
        ? "0 B/s"
        : "—";

    return [
      {
        id: "activity",
        label: "Network Activity",
        value: humanBytes(bytes),
        rateDown,
        rateUp,
        statusBadge: {
          text: activityBadgeText,
          variant: activityBadgeVariant,
        },
        sparklineData: sparklineActivity,
        tooltipRows: [
          { label: "Inbound", value: inboundRate },
          { label: "Outbound", value: outboundRate },
          { label: "Peak Rate", value: peakRate },
          { label: "Avg Rate", value: avgRate },
          { label: "Total Volume", value: humanBytes(bytes) },
          {
            label: "Status",
            value:
              telemetryState === "active"
                ? totalBps > 0
                  ? "Active Traffic"
                  : "Nominal Traffic"
                : `${activityBadgeText} Mode`,
          },
        ],
        tooltip: {
          peak: peakRate,
          avg: avgRate,
          percentile: humanBytes(bytes),
          trend: telemetryState === "active" ? (totalBps > 0 ? "Active" : "Nominal") : activityBadgeText,
        },
      },
      {
        id: "hosts",
        label: "Hosts Observed",
        value: String(hosts),
        statusBadge: {
          text: hosts > 0 ? "Observed" : "Standby",
          variant: hosts > 0 ? "healthy" : "quiet",
        },
        sparklineData: sparklineHosts,
        tooltipRows: [
          { label: "Current", value: `${hosts} endpoints` },
          { label: "Peak", value: `${Math.max(...sparklineHosts, hosts)} endpoints` },
          { label: "Scope", value: "Local & remote hosts" },
          { label: "Trend", value: hosts > 0 ? "Observed" : "Standby" },
        ],
        tooltip: {
          peak: `${Math.max(...sparklineHosts, hosts)} hosts`,
          avg: `${hosts} active`,
          percentile: "Local and remote hosts",
          trend: hosts > 0 ? "Observed" : "Standby",
        },
      },
      {
        id: "flows",
        label: "Active Flows",
        value: String(flows),
        statusBadge: {
          text: flows > 0 ? "Active" : "Standby",
          variant: flows > 0 ? "healthy" : "quiet",
        },
        sparklineData: sparklineFlows,
        tooltipRows: [
          { label: "Current", value: `${flows} active flows` },
          { label: "Peak", value: `${Math.max(...sparklineFlows, flows)} flows` },
          { label: "Scope", value: "Active TCP/UDP sockets" },
          { label: "Trend", value: flows > 0 ? "Active" : "Standby" },
        ],
        tooltip: {
          peak: `${Math.max(...sparklineFlows, flows)} flows`,
          avg: `${flows} active`,
          percentile: "Active TCP/UDP sockets",
          trend: flows > 0 ? "Active" : "Standby",
        },
      },
      {
        id: "cards",
        label: "Narrative Cards",
        value: String(feed.length),
        statusBadge: {
          text: feed.some((f) => f.severity === "finding") ? "Finding" : feed.length > 0 ? "Active" : "Learning",
          variant: feed.some((f) => f.severity === "finding") ? "spike" : feed.length > 0 ? "healthy" : "learning",
        },
        sparklineData: sparklineCards,
        tooltipRows: [
          { label: "Current", value: `${feed.length} narrative cards` },
          { label: "Peak", value: `${Math.max(...sparklineCards, feed.length)} cards` },
          { label: "Feed", value: "All evidence linked" },
          { label: "Trend", value: feed.length > 0 ? "Active" : "Empty" },
        ],
        tooltip: {
          peak: `${Math.max(...sparklineCards, feed.length)} cards`,
          avg: `${feed.length} cards`,
          percentile: "All evidence linked",
          trend: feed.length > 0 ? "Active" : "Empty",
        },
      },
    ];
  }, [monitor, feed, hostsHistory, flowsHistory, cardsHistory]);

  // 4. Health Telemetry View Model (Direct mapping of backend subsystems)
  // ARCHITECTURAL INVARIANT: Rust backend owns SubsystemStatus evaluation.
  // capture_drops is an independent authoritative observation and MUST NOT
  // modify, override, or reinterpret SubsystemStatus.status.
  const healthViewModel: HealthViewModel = useMemo(() => {
    return {
      subsystems: monitor?.subsystems ?? [],
      drops: monitor?.capture_drops ?? 0,
    };
  }, [monitor]);

  // 5. Filtered Narrative Cards (Comprehensive Category & Search Filter)
  const filteredNarratives = useMemo(() => {
    return feed.filter((card) => {
      const head = card.headline.toLowerCase();
      const sum = (card.summary || "").toLowerCase();
      const lines = card.lines.map((l) => l.toLowerCase());
      const allText = [head, sum, ...lines].join(" ");

      // Category Filter
      if (category === "findings" && card.severity !== "finding") return false;
      if (
        category === "performance" &&
        !allText.includes("latency") &&
        !allText.includes("rtt") &&
        !allText.includes("loss") &&
        !allText.includes("delay") &&
        !allText.includes("jitter") &&
        !allText.includes("slow") &&
        !allText.includes("retransmit") &&
        !allText.includes(" ms") &&
        !allText.includes("ms ")
      ) {
        return false;
      }
      if (
        category === "dns" &&
        !allText.includes("dns") &&
        !allText.includes("domain") &&
        !allText.includes("lookup") &&
        !allText.includes("resolve")
      ) {
        return false;
      }
      if (
        category === "tls" &&
        !allText.includes("tls") &&
        !allText.includes("https") &&
        !allText.includes("ssl") &&
        !allText.includes("quic") &&
        !allText.includes("encrypt") &&
        !allText.includes("certificate") &&
        !allText.includes("cipher")
      ) {
        return false;
      }
      if (
        category === "applications" &&
        !allText.includes("app") &&
        !allText.includes("process") &&
        !allText.includes("chrome") &&
        !allText.includes("spotify") &&
        !allText.includes(".exe") &&
        !card.evidence.some((e) => e.kind === "session")
      ) {
        return false;
      }
      if (
        category === "security" &&
        card.severity !== "finding" &&
        card.severity !== "notable" &&
        !allText.includes("security") &&
        !allText.includes("anomal") &&
        !allText.includes("scan") &&
        !allText.includes("tunnel") &&
        !allText.includes("threat")
      ) {
        return false;
      }
      if (
        category === "network" &&
        !allText.includes("flow") &&
        !allText.includes("packet") &&
        !allText.includes("traffic") &&
        !allText.includes("port") &&
        !allText.includes("tcp") &&
        !allText.includes("udp") &&
        !allText.includes("ip") &&
        !allText.includes("server") &&
        !allText.includes("connect") &&
        !card.evidence.some((e) => e.kind === "flow" || e.kind === "packet")
      ) {
        return false;
      }

      // Search Query Filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesHeadline = head.includes(q);
        const matchesSummary = sum.includes(q);
        const matchesLines = card.lines.some((l) => l.toLowerCase().includes(q));
        if (!matchesHeadline && !matchesSummary && !matchesLines) return false;
      }

      return true;
    });
  }, [feed, category, search]);

  // 6. Central Event Dispatcher
  const dispatchEvent = useCallback((event: DashboardEvent) => {
    switch (event.type) {
      case "SET_CATEGORY":
        setCategory(event.category);
        break;
      case "SET_SEARCH":
        setSearch(event.search);
        break;
      case "SET_VIZ_MODE":
        setVizMode(event.mode);
        break;
      case "SET_SELECTED_ENTITY":
        if (sidebar) {
          sidebar.setSelectedEntity(event.entity);
        }
        setLocalSelectedEntity(event.entity);
        break;
    }
  }, [sidebar]);

  return {
    depth,
    shows,
    heroViewModel,
    situationSummaryModel,
    healthViewModel,
    kpiViewModels,
    category,
    search,
    vizMode,
    selectedEntity,
    captureSessionId,
    snapshotSequence,
    monitor,
    feed,
    feedCount: feed.length,
    filteredNarratives,
    dispatchEvent,
  };
}

