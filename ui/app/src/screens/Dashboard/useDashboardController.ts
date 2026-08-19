import { useState, useMemo, useCallback } from "react";
import { useStore } from "../../state/store";
import { useDisclosure } from "../../modes/DisclosureContext";
import { humanBytes } from "@netpulse/viz";
import { generateSituationSummary } from "./SummaryEngine";
import type {
  NarrativeCategory,
  HeroViewModel,
  SituationSummaryModel,
  KpiViewModel,
  HealthViewModel,
  DashboardEvent,
} from "./viewModels";

export function useDashboardController() {
  const { monitor, feed, throughput } = useStore();
  const { depth, shows } = useDisclosure();

  // Local UI states
  const [category, setCategory] = useState<NarrativeCategory>("all");
  const [search, setSearch] = useState("");

  // 1. Situation Summary Model
  const situationSummaryModel: SituationSummaryModel = useMemo(() => {
    return generateSituationSummary(monitor, feed);
  }, [monitor, feed]);

  // 2. Hero View Model (State Machine)
  const heroViewModel: HeroViewModel = useMemo(() => {
    const findings = feed.filter((c) => c.severity === "finding");
    const totalBytes = monitor?.by_protocol.rows.reduce((s, r) => s + r.bytes, 0) ?? 0;
    const hostsCount = monitor?.by_host.rows.length ?? 0;

    if (findings.length > 0) {
      return {
        state: "finding",
        badgeText: "Attention Required",
        title: "Security & Performance Findings Detected",
        subtitle: `${findings.length} finding${findings.length > 1 ? "s" : ""} require your review.`,
      };
    }

    if (totalBytes > 10_000_000) {
      return {
        state: "spike",
        badgeText: "High Traffic",
        title: "Traffic Spike Active",
        subtitle: `Observed high throughput (${humanBytes(totalBytes)}) on local network.`,
      };
    }

    if (hostsCount > 10) {
      return {
        state: "new_device",
        badgeText: "Active Hosts",
        title: `${hostsCount} Devices Connected`,
        subtitle: "Multiple active hosts communicating over local interfaces.",
      };
    }

    return {
      state: "healthy",
      badgeText: "Optimal",
      title: "Network is Healthy",
      subtitle: "Everything looks normal. Passive real-time capture running.",
    };
  }, [feed, monitor]);

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
    const rateFormatted = currentRateBps > 0 ? `${humanBytes(currentRateBps)}/s` : "0 B/s";
    const sparklineActivity = throughputDeltas.length > 0 ? throughputDeltas.slice(-8) : [0];

    return [
      {
        id: "activity",
        label: "Network Activity",
        value: humanBytes(bytes),
        rateDown: `▼ ${rateFormatted}`,
        rateUp: "▲ 0 B/s",
        statusBadge: {
          text: bytes > 5_000_000 ? "Spike" : "Healthy",
          variant: bytes > 5_000_000 ? "spike" : "healthy",
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
          text: hosts > 8 ? "Spike" : "Healthy",
          variant: "healthy",
        },
        sparklineData: [hosts],
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
          text: flows > 30 ? "Congested" : "Quiet",
          variant: flows > 30 ? "congested" : "quiet",
        },
        sparklineData: [flows],
        tooltip: {
          peak: `${flows} flows`,
          avg: `${flows} concurrent`,
          percentile: "5-tuple sessions",
          trend: flows > 0 ? "Active" : "Standby",
        },
      },
      {
        id: "cards",
        label: "Narrative Cards",
        value: String(feed.length),
        statusBadge: {
          text: feed.some((f) => f.severity === "finding") ? "Spike" : "Learning",
          variant: feed.some((f) => f.severity === "finding") ? "spike" : "learning",
        },
        sparklineData: [feed.length],
        tooltip: {
          peak: `${feed.length} cards`,
          avg: "Real-time feed",
          percentile: "All evidence linked",
          trend: feed.length > 0 ? "Active" : "Empty",
        },
      },
    ];
  }, [monitor, feed, throughput]);

  // 4. Health Telemetry View Model
  const healthViewModel: HealthViewModel = useMemo(() => {
    const isCapturing = (monitor?.by_protocol.rows.length ?? 0) > 0 || (monitor?.capture_stats?.buffer_frames ?? 0) > 0;
    const hasDrops = (monitor?.capture_drops ?? 0) > 0;
    return {
      capture: {
        connected: isCapturing,
        label: isCapturing ? "Active" : "Standby",
      },
      flowEngine: {
        healthy: !hasDrops,
        label: hasDrops ? "Dropping" : "Healthy",
      },
      storage: {
        healthy: true,
        label: "Ready",
      },
      ai: {
        ready: true,
        label: "Ready",
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

      // Category Filter
      if (category === "findings" && card.severity !== "finding") return false;
      if (category === "performance" && !head.includes("latency") && !head.includes("rtt") && !head.includes("loss") && !sum.includes("ms")) return false;
      if (category === "dns" && !head.includes("dns") && !sum.includes("dns")) return false;
      if (category === "tls" && !head.includes("tls") && !head.includes("https") && !sum.includes("tls") && !sum.includes("ssl")) return false;
      if (category === "applications" && !head.includes("app") && !head.includes("process") && !sum.includes("chrome") && !sum.includes("spotify")) return false;
      if (category === "security" && card.severity !== "finding" && card.severity !== "notable" && !head.includes("security") && !head.includes("dns")) return false;

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
    }
  }, []);

  return {
    depth,
    shows,
    heroViewModel,
    situationSummaryModel,
    healthViewModel,
    kpiViewModels,
    category,
    search,
    feedCount: feed.length,
    filteredNarratives,
    dispatchEvent,
  };
}
