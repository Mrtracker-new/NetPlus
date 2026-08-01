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
  | null;

export type NavigationSource =
  | "dashboard"
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
  navigateToEvidence: (ref: EvidenceRef, source?: NavigationSource) => void;
  clearNavigationTarget: () => void;
}

const EvidenceNavigationContext = createContext<EvidenceNavigationContextValue | null>(null);

export function EvidenceNavigationProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<Screen>("dashboard");
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget>(null);

  const setScreen = useCallback((nextScreen: Screen) => {
    setScreenState(nextScreen);
    setNavigationTarget(null);
  }, []);

  const navigateToEvidence = useCallback((ref: EvidenceRef, _source?: NavigationSource) => {
    if (!ref || typeof ref !== "object" || !("kind" in ref)) {
      return;
    }
    switch (ref.kind) {
      case "flow":
        setNavigationTarget({ screen: "apps", flowId: ref.id });
        setScreenState("apps");
        break;
      case "session":
        setNavigationTarget({ screen: "journey", sessionId: ref.id });
        setScreenState("journey");
        break;
      case "packet":
        setNavigationTarget({ screen: "timeline", packetId: ref.id });
        setScreenState("timeline");
        break;
    }
  }, []);

  const clearNavigationTarget = useCallback(() => {
    setNavigationTarget(null);
  }, []);

  const value = useMemo(
    () => ({
      screen,
      navigationTarget,
      setScreen,
      navigateToEvidence,
      clearNavigationTarget,
    }),
    [screen, navigationTarget, setScreen, navigateToEvidence, clearNavigationTarget]
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
