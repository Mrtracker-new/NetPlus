// Hand-rolled inline-SVG icons (no icon-library dependency — zero runtime deps,
// matching the hand-rolled viz approach). Stroke-based, 24×24, inherit
// currentColor so the nav's active/hover colors just work. One glyph per nav
// screen plus the header/theme controls.

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
  | "system";

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
};

export function Icon({ name, className, style }: { name: IconName } & IconProps) {
  return <Svg className={className} style={style}>{PATHS[name]}</Svg>;
}
