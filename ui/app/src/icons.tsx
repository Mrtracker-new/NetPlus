// Hand-rolled inline-SVG icons (no icon-library dependency — zero runtime deps,
// matching the hand-rolled viz approach). Stroke-based, 24×24, inherit
// currentColor so the nav's active/hover colors just work. One glyph per nav
// screen plus the header/theme controls.

import type { ReactElement } from "react";

type IconProps = { className?: string };

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...S}>
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
  | "brand";

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
};

export function Icon({ name, className }: { name: IconName } & IconProps) {
  return <Svg className={className}>{PATHS[name]}</Svg>;
}
