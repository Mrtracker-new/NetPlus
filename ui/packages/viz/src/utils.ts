import type { BreakdownRow, HostName } from "@netpulse/contract";

/** Preference order when foregrounding one name, most-trusted/most-relevant
 *  first: SNI (what the client asked for) → DNS (authoritative, seen on the wire)
 *  → hosts file (static local truth) → OS resolver cache (a local hint). */
export function hostSourceRank(s: HostName["source"]): number {
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
      a.name.localeCompare(b.name)
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
