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
  const { monitor, feed, throughput, hostsHistory, flowsHistory, cardsHistory, captureSessionId, snapshotSequence } = useStore();
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

  // 2. Hero View Model (State Machine)
  const heroViewModel: HeroViewModel = useMemo(() => {
    const findings = feed.filter((c) => c.severity === "finding");
    const notables = feed.filter((c) => c.severity === "notable");

    if (findings.length > 0) {
      return {
        state: "finding",
        badgeText: "Attention",
        title: "Security & Performance Findings Detected",
        subtitle: `${findings.length} finding${findings.length > 1 ? "s" : ""} require your review.`,
      };
    }

    if (notables.length > 0) {
      return {
        state: "spike",
        badgeText: "Notable",
        title: "Notable Network Activity",
        subtitle: `${notables.length} notable event${notables.length > 1 ? "s" : ""} recorded across local connection.`,
      };
    }

    return {
      state: "healthy",
      badgeText: "Nominal",
      title: "Network Operating Normally",
      subtitle: "Passive telemetry active. No critical anomalies detected.",
    };
  }, [feed]);

  // 3. KPI View Models
  const kpiViewModels: KpiViewModel[] = useMemo(() => {
    const hosts = monitor?.by_host.rows.length ?? 0;
    const flows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;
    const bytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;

    let currentRateBps = 0;
    const throughputDeltas: number[] = [];
    if (throughput && throughput.length >= 2) {
      for (let i = 1; i < throughput.length; i++) {
        const delta = Math.max(0, (throughput[i] ?? 0) - (throughput[i - 1] ?? 0));
        throughputDeltas.push(delta);
      }
      currentRateBps = throughputDeltas[throughputDeltas.length - 1] ?? 0;
    }
    const rateFormatted = currentRateBps > 0 ? `${humanBytes(currentRateBps)}/s` : "0 B/s (Idle)";
    const sparklineActivity =
      throughputDeltas.length > 1
        ? throughputDeltas.slice(-8)
        : [];
    const sparklineHosts = hostsHistory && hostsHistory.length > 1 ? hostsHistory.slice(-8) : [];
    const sparklineFlows = flowsHistory && flowsHistory.length > 1 ? flowsHistory.slice(-8) : [];
    const sparklineCards = cardsHistory && cardsHistory.length > 1 ? cardsHistory.slice(-8) : [];

    return [
      {
        id: "activity",
        label: "Network Activity",
        value: humanBytes(bytes),
        rateDown: currentRateBps > 0 ? `▼ ${rateFormatted}` : "▼ 0 B/s (Idle)",
        rateUp: undefined,
        statusBadge: {
          text: currentRateBps > 10_000_000 ? "Active" : "Nominal",
          variant: "healthy",
        },
        sparklineData: sparklineActivity,
        tooltip: {
          peak: `${humanBytes(Math.max(...sparklineActivity, currentRateBps))}/s`,
          avg: `${humanBytes(bytes)} total`,
          percentile: `${hosts} hosts`,
          trend: currentRateBps > 0 ? "Active" : "Standby",
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
        tooltip: {
          peak: `${hosts} hosts`,
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
        tooltip: {
          peak: `${flows} flows`,
          avg: "Concurrent network streams",
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
        tooltip: {
          peak: `${feed.length} cards`,
          avg: "Real-time feed",
          percentile: "All evidence linked",
          trend: feed.length > 0 ? "Active" : "Empty",
        },
      },
    ];
  }, [monitor, feed, throughput, hostsHistory, flowsHistory, cardsHistory]);

  // 4. Health Telemetry View Model
  const healthViewModel: HealthViewModel = useMemo(() => {
    const isCapturing = (monitor?.by_protocol.rows.length ?? 0) > 0 || (monitor?.capture_stats?.buffer_frames ?? 0) > 0;
    const shedStage = monitor?.capture_stats?.shed_stage;
    const isDropping = shedStage === "drop_packets";
    const isDegraded = shedStage === "payloads_off" || shedStage === "sample_dissection" || shedStage === "coarsen_metrics";

    return {
      capture: {
        connected: isCapturing,
        label: isCapturing ? "Active" : "Standby",
      },
      flowEngine: {
        healthy: !isDropping,
        label: isDropping ? "Dropping" : isDegraded ? "Degraded" : isCapturing ? "Healthy" : "Standby",
      },
      storage: {
        healthy: true,
        label: "Active (Ring Buffer)",
      },
      ai: {
        ready: true,
        label: "Local Heuristics",
      },
      npcap: {
        connected: isCapturing,
        label: isCapturing ? "Capturing" : "Standby",
      },
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
    feedCount: feed.length,
    filteredNarratives,
    dispatchEvent,
  };
}

