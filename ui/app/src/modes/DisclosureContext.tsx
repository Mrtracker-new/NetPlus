// Progressive disclosure — the UX backbone of the whole app.
//
// Mode is a single piece of UI state read by every disclosure-aware component
//It is *also* sent to the engine as a projection depth on
// queries, so a beginner view never hauls expert detail across the boundary.
// First run defaults to Beginner and the choice is remembered.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ProjectionDepth } from "@netpulse/contract";
import { command } from "../ipc";

const STORAGE_KEY = "netpulse.depth";
const ORDER: ProjectionDepth[] = ["beginner", "intermediate", "expert"];

interface DisclosureState {
  depth: ProjectionDepth;
  setDepth: (d: ProjectionDepth) => void;
  /** True when `depth` is deep enough to show content authored for `required` —
   *  the additive rule: an expert view also shows beginner text. */
  shows: (required: ProjectionDepth) => boolean;
}

const DisclosureCtx = createContext<DisclosureState | null>(null);

function rank(d: ProjectionDepth): number {
  return ORDER.indexOf(d);
}

function initialDepth(): ProjectionDepth {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "intermediate" || saved === "expert" ? saved : "beginner";
}

export function DisclosureProvider({ children }: { children: ReactNode }) {
  const [depth, setDepthState] = useState<ProjectionDepth>(initialDepth);

  const setDepth = useCallback((d: ProjectionDepth) => {
    setDepthState(d);
    localStorage.setItem(STORAGE_KEY, d);
  }, []);

  // Keep engine projection depth synchronized on startup and on depth changes
  useEffect(() => {
    void command({ kind: "setDepth", depth }).catch(() => {
      /* Browser preview / test env without Tauri host */
    });
  }, [depth]);

  const value = useMemo<DisclosureState>(
    () => ({
      depth,
      setDepth,
      shows: (required) => rank(depth) >= rank(required),
    }),
    [depth, setDepth],
  );

  return <DisclosureCtx.Provider value={value}>{children}</DisclosureCtx.Provider>;
}

export function useDisclosure(): DisclosureState {
  const ctx = useContext(DisclosureCtx);
  if (!ctx) {
    throw new Error("useDisclosure must be used within a DisclosureProvider");
  }
  return ctx;
}

export { ORDER as DEPTHS };
