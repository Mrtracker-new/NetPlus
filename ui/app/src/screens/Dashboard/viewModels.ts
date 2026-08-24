export type NarrativeCategory =
  | "all"
  | "findings"
  | "network"
  | "performance"
  | "dns"
  | "tls"
  | "applications"
  | "security";

export interface HeroViewModel {
  state: "healthy" | "spike" | "new_device" | "finding" | "idle";
  badgeText: string;
  title: string;
  subtitle: string;
}

export interface RecommendationItem {
  type: "investigate" | "ignore" | "monitor";
  text: string;
  actionText?: string;
}

export interface SituationSummaryModel {
  overallHealth: "healthy" | "notable" | "finding";
  headline: string;
  explanation: string;
  highlights: string[];
  recommendations: RecommendationItem[];
}

export interface KpiViewModel {
  id: string;
  label: string;
  value: string;
  rateUp?: string;
  rateDown?: string;
  statusBadge: {
    text: string;
    variant: "healthy" | "learning" | "spike" | "quiet" | "congested";
  };
  sparklineData: number[];
  tooltip: {
    peak: string;
    avg: string;
    percentile: string;
    trend: string;
  };
}

export interface HealthViewModel {
  capture: { connected: boolean; label: string };
  flowEngine: { healthy: boolean; label: string };
  storage: { healthy: boolean; label: string };
  ai: { ready: boolean; label: string };
  npcap: { connected: boolean; label: string };
  drops: number;
}

import type { SelectedEntity } from "@netpulse/viz";

export type VizMode = "map" | "topology";

export type DashboardEvent =
  | { type: "SET_CATEGORY"; category: NarrativeCategory }
  | { type: "SET_SEARCH"; search: string }
  | { type: "SET_VIZ_MODE"; mode: VizMode }
  | { type: "SET_SELECTED_ENTITY"; entity: SelectedEntity | null };

