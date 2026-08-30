// Hand-rolled inline-SVG icons (no icon-library dependency — zero runtime deps,
// matching the hand-rolled viz approach). Stroke-based, 24×24, inherit
// currentColor so the nav's active/hover colors just work. One glyph per nav
// screen plus headers, controls, cards, and state badges.

import type { ReactElement } from "react";

type IconProps = { className?: string; style?: React.CSSProperties };

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true" {...S}>
      {children}
    </svg>
  );
}

export type IconName =
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
  | "sun"
  | "moon"
  | "search"
  | "brand"
  | "diagnostics"
  | "sandbox"
  | "fleet"
  | "compare"
  | "sidebar"
  | "close"
  | "chevronLeft"
  | "chevronRight"
  | "context"
  | "session"
  | "system"
  | "lock"
  | "globe"
  | "trash"
  | "chat"
  | "lightbulb"
  | "sparkles"
  | "target"
  | "microscope"
  | "book"
  | "download"
  | "upload"
  | "pin"
  | "check"
  | "checkCircle"
  | "alertTriangle"
  | "alertCircle"
  | "clock"
  | "trophy"
  | "play"
  | "pause"
  | "stepForward"
  | "stop"
  | "help"
  | "settings"
  | "box"
  | "shieldCheck"
  | "shieldAlert"
  | "radio"
  | "zap"
  | "copy"
  | "circleDot"
  | "wifi"
  | "server"
  | "router"
  | "cpu"
  | "activity"
  | "database"
  | "arrowRight"
  | "layers"
  | "refresh"
  | "crosshair";

const PATHS: Record<IconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  journey: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12h4M14 7l-3 4 3 4" />
    </>
  ),
  timeline: (
    <>
      <path d="M4 12h16" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="12" r="2" />
      <path d="M8 6v2M16 16v2" />
    </>
  ),
  monitoring: (
    <>
      <path d="M3 12h3l2-6 4 12 2-6h4" />
    </>
  ),
  apps: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  security: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 3a7 7 0 0 1 7 7c0 2-1 3.5-2.5 4.8V18a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-3.2C6 13.5 5 12 5 10a7 7 0 0 1 7-7z" />
      <path d="M9 20h6" />
    </>
  ),
  learn: (
    <>
      <path d="M3 6l9-3 9 3-9 3z" />
      <path d="M7 9v5c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5V9" />
    </>
  ),
  explorer: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l4 4" />
    </>
  ),
  recordings: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 1 1 2.3 5.6" />
      <path d="M4 20v-4h4" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v11" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  plugins: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  moon: (
    <>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l4 4" />
    </>
  ),
  brand: (
    <>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </>
  ),
  diagnostics: (
    <>
      <path d="M7 4v5.5a5 5 0 0 0 10 0V4" />
      <path d="M12 14.5v2a2.5 2.5 0 0 0 2.5 2.5h1.5" />
      <circle cx="17.5" cy="19" r="1.2" />
      <path d="M5.5 4h3M15.5 4h3" />
    </>
  ),
  sandbox: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v4.5l-5.2 8.8A2 2 0 0 0 6.5 19.5h11a2 2 0 0 0 1.7-3.2L14 7.5V3" />
      <path d="M8.5 14h7" />
    </>
  ),
  fleet: (
    <>
      <rect x="3" y="3" width="18" height="5" rx="1.5" />
      <rect x="3" y="9.5" width="18" height="5" rx="1.5" />
      <rect x="3" y="16" width="18" height="5" rx="1.5" />
      <circle cx="6" cy="5.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="6" cy="18.5" r="0.75" fill="currentColor" stroke="none" />
      <path d="M10 5.5h5M10 12h5M10 18.5h5" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
      <path d="M9 10l-2 2 2 2" />
      <path d="M15 10l2 2-2 2" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </>
  ),
  close: (
    <>
      <path d="M18 6L6 18M6 6l12 12" />
    </>
  ),
  chevronLeft: (
    <>
      <path d="M15 18l-6-6 6-6" />
    </>
  ),
  chevronRight: (
    <>
      <path d="M9 18l6-6-6-6" />
    </>
  ),
  context: (
    <>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </>
  ),
  session: (
    <>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </>
  ),
  system: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M11.5 3a14.5 14.5 0 0 1 0 18M12.5 3a14.5 14.5 0 0 0 0 18" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
  chat: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.9 4.8L19 9.8l-4.1 3.5L16.2 18 12 15.2 7.8 18l1.3-4.7L5 9.8l5.1-2z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  microscope: (
    <>
      <path d="M6 18h12M12 18v-4M9 14h6" />
      <path d="M12 6a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3 3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM12 3v3" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </>
  ),
  pin: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  check: (
    <>
      <path d="M20 6L9 17l-5-5" />
    </>
  ),
  checkCircle: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2M6 3h12v7a6 6 0 0 1-12 0V3zM9 21h6M12 16v5" />
    </>
  ),
  play: (
    <>
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stepForward: (
    <>
      <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
      <line x1="19" y1="5" x2="19" y2="19" strokeWidth="2.2" />
    </>
  ),
  stop: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  box: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  shieldAlert: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
    </>
  ),
  zap: (
    <>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  circleDot: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  wifi: (
    <>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="2.4" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="2.2" />
      <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="2.2" />
    </>
  ),
  router: (
    <>
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 18h.01" strokeWidth="2.2" />
      <path d="M10 18h.01" strokeWidth="2.2" />
      <path d="M15 10v4" />
      <path d="M9 10v4" />
      <path d="M12 2v12" />
    </>
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="15" x2="23" y2="15" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="15" x2="4" y2="15" />
    </>
  ),
  activity: (
    <>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </>
  ),
  arrowRight: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="22" y1="12" x2="18" y2="12" />
      <line x1="6" y1="12" x2="2" y2="12" />
      <line x1="12" y1="6" x2="12" y2="2" />
      <line x1="12" y1="22" x2="12" y2="18" />
    </>
  ),
};

export function Icon({ name, className, style }: { name: IconName } & IconProps) {
  return <Svg className={className} style={style}>{PATHS[name]}</Svg>;
}
