import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { EvidenceRef } from "@netpulse/contract";

export type Screen =
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
  | "diagnostics"
  | "sandbox"
  | "fleet"
  | "compare";

export type NavigationTarget =
  | { screen: "apps"; flowId: number }
  | { screen: "journey"; sessionId: number }
  | { screen: "timeline"; packetId?: number; timestamp?: number }
  | { screen: "diagnostics"; target?: string }
  | null;

export type NavigationSource =
  | "dashboard"
  | "journey"
  | "apps"
  | "constellation"
  | "timeline"
  | "compare"
  | "sandbox"
  | "feed"
  | "kpi";

export interface EvidenceNavigationContextValue {
  screen: Screen;
  navigationTarget: NavigationTarget;
  setScreen: (screen: Screen) => void;
  setNavigationTarget: (target: NavigationTarget) => void;
  navigateToEvidence: (ref: EvidenceRef, source?: NavigationSource) => void;
  clearNavigationTarget: () => void;
}

export const EvidenceNavigationContext = createContext<EvidenceNavigationContextValue | null>(null);

export function EvidenceNavigationProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<Screen>("dashboard");
  const [navigationTarget, setNavigationTargetState] = useState<NavigationTarget>(null);

  const setScreen = useCallback((newScreen: Screen) => {
    setScreenState(newScreen);
  }, []);

  const setNavigationTarget = useCallback((target: NavigationTarget) => {
    setNavigationTargetState(target);
    if (target?.screen) {
      setScreenState(target.screen);
    }
  }, []);

  const navigateToEvidence = useCallback((ref: EvidenceRef, _source?: NavigationSource) => {
    if (ref.kind === "flow") {
      setNavigationTargetState({ screen: "apps", flowId: ref.id });
      setScreenState("apps");
    } else if (ref.kind === "session") {
      setNavigationTargetState({ screen: "journey", sessionId: ref.id });
      setScreenState("journey");
    } else if (ref.kind === "packet") {
      setNavigationTargetState({ screen: "timeline", packetId: ref.id });
      setScreenState("timeline");
    }
  }, []);

  const clearNavigationTarget = useCallback(() => {
    setNavigationTargetState(null);
  }, []);

  const value = useMemo(
    () => ({
      screen,
      navigationTarget,
      setScreen,
      setNavigationTarget,
      navigateToEvidence,
      clearNavigationTarget,
    }),
    [screen, navigationTarget, setScreen, setNavigationTarget, navigateToEvidence, clearNavigationTarget]
  );

  return (
    <EvidenceNavigationContext.Provider value={value}>
      {children}
    </EvidenceNavigationContext.Provider>
  );
}

export function useEvidenceNavigation(): EvidenceNavigationContextValue {
  const context = useContext(EvidenceNavigationContext);
  if (!context) {
    throw new Error("useEvidenceNavigation must be used within an EvidenceNavigationProvider");
  }
  return context;
}

export function useOptionalEvidenceNavigation(): EvidenceNavigationContextValue | null {
  return useContext(EvidenceNavigationContext);
}
