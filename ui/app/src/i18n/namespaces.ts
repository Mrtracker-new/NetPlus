export const NAMESPACE = {
  COMMON: "common",
  DASHBOARD: "dashboard",
  APPS: "apps",
  JOURNEY: "journey",
  TIMELINE: "timeline",
  MONITORING: "monitoring",
  DIAGNOSTICS: "diagnostics",
  SANDBOX: "sandbox",
  FLEET: "fleet",
  COMPARE: "compare",
  SECURITY: "security",
  ASSISTANT: "assistant",
  LEARN: "learn",
  EXPLORER: "explorer",
  RECORDINGS: "recordings",
  REPLAY: "replay",
  EXPORT: "export",
  PLUGINS: "plugins",
  SETTINGS: "settings",
  ERRORS: "errors",
} as const;

export type Namespace = (typeof NAMESPACE)[keyof typeof NAMESPACE];

export const ALL_NAMESPACES: readonly Namespace[] = Object.values(NAMESPACE);
export const DEFAULT_NAMESPACE: Namespace = NAMESPACE.COMMON;
