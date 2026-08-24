import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import type { SelectedEntity } from "@netpulse/viz";

export type RightRailTab = "context" | "session" | "system";

export interface SidebarContextValue {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  activeTab: RightRailTab;
  selectedEntity: SelectedEntity | null;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  openMobile: () => void;
  closeMobile: () => void;
  toggleMobile: () => void;
  setActiveTab: (tab: RightRailTab) => void;
  setSelectedEntity: (entity: SelectedEntity | null) => void;
}

const STORAGE_KEY = "netpulse.sidebar.collapsed.v1";

export const SidebarContext = createContext<SidebarContextValue | null>(null);

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore storage access errors */
  }
  return false;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsedState] = useState<boolean>(getInitialCollapsed);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const [activeTab, setActiveTabState] = useState<RightRailTab>("context");
  const [selectedEntity, setSelectedEntityState] = useState<SelectedEntity | null>(null);

  const setCollapsed = useCallback((value: boolean) => {
    setIsCollapsedState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore storage access errors */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore storage access errors */
      }
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setIsMobileOpen(true), []);
  const closeMobile = useCallback(() => setIsMobileOpen(false), []);
  const toggleMobile = useCallback(() => setIsMobileOpen((prev) => !prev), []);

  const setActiveTab = useCallback((tab: RightRailTab) => {
    setActiveTabState(tab);
  }, []);

  const setSelectedEntity = useCallback((entity: SelectedEntity | null) => {
    setSelectedEntityState(entity);
    if (entity) {
      setActiveTabState("context");
    }
  }, []);

  // Global Keyboard Shortcut: Ctrl+\ or Cmd+\
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "\\" || !(e.ctrlKey || e.metaKey)) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (e.defaultPrevented) return;

      e.preventDefault();
      if (window.innerWidth <= 1120) {
        setIsMobileOpen((prev) => !prev);
      } else {
        toggleCollapsed();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCollapsed]);

  const value = useMemo(
    () => ({
      isCollapsed,
      isMobileOpen,
      activeTab,
      selectedEntity,
      setCollapsed,
      toggleCollapsed,
      openMobile,
      closeMobile,
      toggleMobile,
      setActiveTab,
      setSelectedEntity,
    }),
    [
      isCollapsed,
      isMobileOpen,
      activeTab,
      selectedEntity,
      setCollapsed,
      toggleCollapsed,
      openMobile,
      closeMobile,
      toggleMobile,
      setActiveTab,
      setSelectedEntity,
    ]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}

export function useOptionalSidebar(): SidebarContextValue | null {
  return useContext(SidebarContext);
}

