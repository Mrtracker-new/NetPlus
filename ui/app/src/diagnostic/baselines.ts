/**
 * Centralized Baselines and Thresholds for Diagnostic Metrics.
 */

export interface MetricBaseline {
  normalMax: number;
  elevatedMax: number;
  unit: string;
  description: string;
}

export type BaselineTier = "local" | "metro" | "continental" | "intercontinental" | "default";

const BASELINES_BY_TIER: Record<BaselineTier, Record<string, MetricBaseline>> = {
  local: {
    ping_rtt: { normalMax: 10, elevatedMax: 30, unit: "ms", description: "Local network round-trip time" },
    gateway_rtt: { normalMax: 4, elevatedMax: 15, unit: "ms", description: "Default gateway round-trip time" },
    loss_pct: { normalMax: 0, elevatedMax: 2, unit: "%", description: "Packet loss percentage" },
    dns_rtt: { normalMax: 25, elevatedMax: 75, unit: "ms", description: "DNS query resolution latency" },
    bufferbloat_delta: { normalMax: 20, elevatedMax: 60, unit: "ms", description: "Latency increase under buffer load" },
    http_ttfb: { normalMax: 100, elevatedMax: 300, unit: "ms", description: "Time to first byte" },
  },
  metro: {
    ping_rtt: { normalMax: 35, elevatedMax: 80, unit: "ms", description: "Metro area round-trip time" },
    gateway_rtt: { normalMax: 5, elevatedMax: 20, unit: "ms", description: "Default gateway round-trip time" },
    loss_pct: { normalMax: 0, elevatedMax: 3, unit: "%", description: "Packet loss percentage" },
    dns_rtt: { normalMax: 45, elevatedMax: 120, unit: "ms", description: "DNS query resolution latency" },
    bufferbloat_delta: { normalMax: 30, elevatedMax: 80, unit: "ms", description: "Latency increase under buffer load" },
    http_ttfb: { normalMax: 200, elevatedMax: 600, unit: "ms", description: "Time to first byte" },
  },
  continental: {
    ping_rtt: { normalMax: 70, elevatedMax: 140, unit: "ms", description: "Continental round-trip time" },
    gateway_rtt: { normalMax: 5, elevatedMax: 20, unit: "ms", description: "Default gateway round-trip time" },
    loss_pct: { normalMax: 0, elevatedMax: 4, unit: "%", description: "Packet loss percentage" },
    dns_rtt: { normalMax: 60, elevatedMax: 160, unit: "ms", description: "DNS query resolution latency" },
    bufferbloat_delta: { normalMax: 40, elevatedMax: 100, unit: "ms", description: "Latency increase under buffer load" },
    http_ttfb: { normalMax: 300, elevatedMax: 900, unit: "ms", description: "Time to first byte" },
  },
  intercontinental: {
    ping_rtt: { normalMax: 180, elevatedMax: 280, unit: "ms", description: "Intercontinental round-trip time" },
    gateway_rtt: { normalMax: 5, elevatedMax: 20, unit: "ms", description: "Default gateway round-trip time" },
    loss_pct: { normalMax: 0.5, elevatedMax: 5, unit: "%", description: "Packet loss percentage" },
    dns_rtt: { normalMax: 100, elevatedMax: 250, unit: "ms", description: "DNS query resolution latency" },
    bufferbloat_delta: { normalMax: 60, elevatedMax: 150, unit: "ms", description: "Latency increase under buffer load" },
    http_ttfb: { normalMax: 500, elevatedMax: 1400, unit: "ms", description: "Time to first byte" },
  },
  default: {
    ping_rtt: { normalMax: 40, elevatedMax: 100, unit: "ms", description: "Target round-trip latency" },
    gateway_rtt: { normalMax: 5, elevatedMax: 20, unit: "ms", description: "Default gateway latency" },
    loss_pct: { normalMax: 0, elevatedMax: 3, unit: "%", description: "Packet loss percentage" },
    dns_rtt: { normalMax: 50, elevatedMax: 150, unit: "ms", description: "DNS resolution latency" },
    bufferbloat_delta: { normalMax: 30, elevatedMax: 100, unit: "ms", description: "Bufferbloat delta latency" },
    http_ttfb: { normalMax: 250, elevatedMax: 800, unit: "ms", description: "HTTP time to first byte" },
  },
};

/**
 * Retrieve baseline thresholds for a specific location context and metric.
 */
export function getBaseline(metric: string, tier: BaselineTier = "default"): MetricBaseline {
  const tierBaselines = BASELINES_BY_TIER[tier] ?? BASELINES_BY_TIER.default;
  return (
    tierBaselines[metric] ??
    BASELINES_BY_TIER.default[metric] ?? {
      normalMax: 100,
      elevatedMax: 300,
      unit: "ms",
      description: "Default metric baseline",
    }
  );
}
