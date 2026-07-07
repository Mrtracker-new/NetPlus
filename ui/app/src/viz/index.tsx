// NetPulse visualization primitives (docs/16). Framework-light SVG, colored from
// the "Signal" design tokens so charts read as one system with the rest of the UI.
// Kept in the app for now; the empty @netpulse/viz package is reserved for later
// extraction (docs/03 §9.1).
//
// Color discipline (dataviz method): one axis, thin marks, a legend for ≥2 series,
// text in ink tokens (never the series color). The categorical palette below is
// CVD-validated (colorblind-safe) against the dark surface — do not cycle it or
// append an unvalidated 8th hue.

import { Fragment } from "react";
import type { ReactElement } from "react";
import type {
  BreakdownRow,
  FanoutNode,
  HostName,
  JourneyStage,
  Severity,
  StageKind,
} from "@netpulse/contract";

// ---------------------------------------------------------- Host name display
//
// The engine labels host breakdown rows with the raw destination IP (the
// authoritative key) and attaches any names for it. Two come from the wire and
// never involve a lookup we made — DNS answers and TLS SNI (netpulse-flow
// resolution.rs); two more are read from *local* machine state by the shell to
// recover names for lookups that predated capture — the hosts file and the OS
// DNS resolver cache (incl. cached mDNS), still with zero egress. These helpers
// choose what to *foreground* for a human without ever discarding the IP.

/** Preference order when foregrounding one name, most-trusted/most-relevant
 *  first: SNI (what the client asked for) → DNS (authoritative, seen on the wire)
 *  → hosts file (static local truth) → OS resolver cache (a local hint). */
function hostSourceRank(s: HostName["source"]): number {
  switch (s) {
    case "sni":
      return 0;
    case "dns":
      return 1;
    case "hosts_file":
      return 2;
    case "os_resolver":
      return 3;
    default:
      return 4;
  }
}

/** A short, honest provenance tag so a foregrounded name is never mistaken for a
 *  lookup we performed against the network. */
export function hostSourceLabel(s: HostName["source"]): string {
  switch (s) {
    case "sni":
      return "TLS SNI";
    case "dns":
      return "DNS";
    case "hosts_file":
      return "hosts file";
    case "os_resolver":
      return "OS DNS cache";
    default:
      return "local";
  }
}

/** The single most legible name for a row, or null if none was observed. Prefers
 *  SNI over DNS, then the shortest name (a bare apex reads better than a long CDN
 *  label), ties broken alphabetically for a stable choice. */
export function primaryHostName(row: BreakdownRow): HostName | null {
  if (!row.hostnames || row.hostnames.length === 0) return null;
  return [...row.hostnames].sort(
    (a, b) =>
      hostSourceRank(a.source) - hostSourceRank(b.source) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  )[0]!;
}

/** CVD-safe categorical hues, fixed order (validated: lightness band, chroma,
 *  adjacent-pair CVD ≥ 12, contrast). Assigned by entity, never by rank. */
export const CATEGORICAL = [
  "#1EA39C", // teal
  "#B47B24", // amber
  "#7C83F7", // indigo
  "#E04E54", // rose
  "#3FA87C", // green
  "#D65BB0", // magenta
  "#3E8FE0", // blue
] as const;

export function categoricalColor(i: number): string {
  // Fold anything past the palette into a neutral "other" rather than inventing a
  // hue (dataviz non-negotiable).
  return i < CATEGORICAL.length ? CATEGORICAL[i]! : "var(--np-text-mute)";
}

export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// ------------------------------------------------------------------ Sparkline

/** A tiny inline trend line — no axes, no legend (a single series names itself). */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = "var(--np-accent)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}): ReactElement | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="np-viz-spark" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ AreaChart

/** A single-series area over time (e.g. throughput). One axis; the max is labeled
 *  directly rather than drawing a full scale. */
export function AreaChart({
  values,
  height = 96,
  format = (n: number) => String(Math.round(n)),
  label,
}: {
  values: number[];
  height?: number;
  format?: (n: number) => string;
  label?: string;
}): ReactElement {
  const W = 100; // viewBox units; SVG scales to container width
  if (values.length < 2) {
    return <div className="np-viz-empty">Not enough samples yet…</div>;
  }
  const max = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const y = (v: number) => height - (v / max) * (height - 6) - 2;
  const line = values.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,${height} ${line} ${W},${height}`;
  return (
    <figure className="np-viz-area">
      {label && (
        <figcaption className="np-viz-cap">
          {label} <span className="np-viz-peak">peak {format(max)}</span>
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="np-viz-area__svg">
        <defs>
          <linearGradient id="np-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--np-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--np-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#np-area-fill)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--np-accent)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------- Donut

interface Slice {
  label: string;
  value: number;
}

/** A categorical donut (e.g. protocol mix by bytes) with a legend + direct labels.
 *  Identity is carried by the legend swatch, never color alone. */
export function Donut({
  slices,
  size = 132,
  centerLabel,
  format = (n: number) => String(n),
}: {
  slices: Slice[];
  size?: number;
  centerLabel?: string;
  format?: (n: number) => string;
}): ReactElement {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2;
  const stroke = size * 0.16;
  const radius = r - stroke / 2 - 1;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  const ranked = [...slices].sort((a, b) => b.value - a.value);

  return (
    <div className="np-viz-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Breakdown">
        <g transform={`rotate(-90 ${r} ${r})`}>
          {total > 0 &&
            ranked.map((s, i) => {
              const frac = s.value / total;
              const dash = frac * circ;
              const seg = (
                <circle
                  key={s.label}
                  cx={r}
                  cy={r}
                  r={radius}
                  fill="none"
                  stroke={categoricalColor(i)}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(dash - 2, 0)} ${circ - Math.max(dash - 2, 0)}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return seg;
            })}
          {total === 0 && (
            <circle cx={r} cy={r} r={radius} fill="none" stroke="var(--np-surface-3)" strokeWidth={stroke} />
          )}
        </g>
        <text x={r} y={r - 2} textAnchor="middle" className="np-viz-donut__total">
          {format(total)}
        </text>
        {centerLabel && (
          <text x={r} y={r + 14} textAnchor="middle" className="np-viz-donut__sub">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="np-viz-legend">
        {ranked.map((s, i) => (
          <li key={s.label}>
            <span className="np-viz-legend__dot" style={{ background: categoricalColor(i) }} />
            <span className="np-viz-legend__label">{s.label}</span>
            <span className="np-viz-legend__val">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -------------------------------------------------------------- BarRow (bars)

/** A horizontal magnitude bar, baseline-anchored, for ranked breakdowns. */
export function BarRow({
  label,
  value,
  max,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
}): ReactElement {
  const pct = max > 0 ? Math.max((value / max) * 100, 1.5) : 0;
  return (
    <div className="np-viz-bar">
      <span className="np-viz-bar__label" title={label}>
        {label}
      </span>
      <span className="np-viz-bar__track">
        <span className="np-viz-bar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="np-viz-bar__val">{suffix}</span>
    </div>
  );
}

// --------------------------------------------------------------- JourneyFlow

// A short glyph per stage — shape carries meaning alongside color (never
// color-alone). Kept ASCII/simple so it renders without a font dependency.
const STAGE_GLYPH: Record<StageKind, string> = {
  navigation: "⌖",
  dns_resolution: "?",
  connection: "⇄",
  encryption: "🔒",
  request: "↧",
  fan_out: "⋔",
  completion: "✓",
};

/** The signature "what happened after I typed the URL" diagram (docs/14): the
 *  page-load stages as connected nodes with packets traveling the links, then the
 *  CDN/organization fan-out — one visit, many companies made visible (docs/14 §5). */
export function JourneyFlow({
  stages,
  fanout,
}: {
  stages: JourneyStage[];
  fanout: FanoutNode[];
}): ReactElement {
  const topFanout = [...fanout].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  return (
    <div className="np-jflow">
      <div className="np-jflow__track">
        {stages.map((s, i) => (
          <Fragment key={`${s.kind}-${i}`}>
            <div className="np-jflow__node" title={s.narration}>
              <span className="np-jflow__glyph" aria-hidden="true">
                {STAGE_GLYPH[s.kind] ?? "•"}
              </span>
              <span className="np-jflow__label">{s.title}</span>
            </div>
            {i < stages.length - 1 && (
              <div className="np-jflow__link" aria-hidden="true">
                <span className="np-jflow__packet" style={{ animationDelay: `${i * 0.35}s` }} />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {topFanout.length > 0 && (
        <div className="np-jflow__fanout" aria-label="Servers contacted">
          <div className="np-jflow__hub" aria-hidden="true">
            {stages.length}
          </div>
          <ul className="np-jflow__dests">
            {topFanout.map((n) => (
              <li className="np-jflow__dest" key={n.label}>
                <span className="np-jflow__dest-label" title={n.label}>
                  {n.label}
                </span>
                <span className="np-jflow__dest-meta">
                  {n.flows} conn · {humanBytes(n.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- TimeRibbon

export interface RibbonEvent {
  at: number;
  label: string;
  severity: Severity;
}

const RIBBON_LANES: Array<{ severity: Severity; label: string }> = [
  { severity: "finding", label: "Findings" },
  { severity: "notable", label: "Notable" },
  { severity: "neutral", label: "Events" },
];

/** Events on one shared time axis, laned by severity (docs/10 §4): anything at the
 *  same moment lines up vertically. Marks carry severity by shape+color and name
 *  themselves on hover — the drill-down entry point from the time axis (docs/10 §6). */
export function TimeRibbon({ events }: { events: RibbonEvent[] }): ReactElement {
  if (events.length === 0) {
    return <div className="np-empty">No events yet — the timeline fills as traffic is reconstructed.</div>;
  }
  const times = events.map((e) => e.at);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  const pos = (at: number) => `${(((at - min) / span) * 98).toFixed(2)}%`;

  return (
    <div className="np-ribbon">
      {RIBBON_LANES.map((lane) => {
        const laneEvents = events.filter((e) => e.severity === lane.severity);
        return (
          <div className="np-ribbon__lane" key={lane.severity}>
            <span className="np-ribbon__lane-label">{lane.label}</span>
            <div className="np-ribbon__track">
              {laneEvents.map((e, i) => (
                <span
                  key={`${e.at}-${i}`}
                  className="np-ribbon__mark"
                  data-sev={e.severity}
                  style={{ left: pos(e.at) }}
                  title={e.label}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className="np-ribbon__axis">
        <span>earlier</span>
        <span>now</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ ConfidenceMeter

/** A calibrated-confidence meter (docs/17 §5). Neutral accent — confidence is not
 *  severity, so it never uses an alarm color; the qualitative word carries meaning
 *  alongside the number. */
export function ConfidenceMeter({
  percent,
  qualitative,
}: {
  percent: number;
  qualitative?: string;
}): ReactElement {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="np-viz-conf" role="meter" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <span className="np-viz-conf__track">
        <span className="np-viz-conf__fill" style={{ width: `${p}%` }} />
      </span>
      <span className="np-viz-conf__num">
        {qualitative ? `${qualitative} · ` : ""}
        {p}%
      </span>
    </div>
  );
}
