export const NAMESPACE = {
  COMMON: "common",
  DASHBOARD: "dashboard",
  ASSISTANT: "assistant",
  PLUGINS: "plugins",
  SECURITY: "security",
  EXPORT: "export",
  SETTINGS: "settings",
  ERRORS: "errors",
} as const;

export type Namespace = (typeof NAMESPACE)[keyof typeof NAMESPACE];

export const ALL_NAMESPACES: readonly Namespace[] = Object.values(NAMESPACE);
export const DEFAULT_NAMESPACE: Namespace = NAMESPACE.COMMON;
