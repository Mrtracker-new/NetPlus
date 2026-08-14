import { useEffect, useRef } from "react";
import { useSidebar } from "./useSidebar";
import { RightRailTabs } from "./RightRailTabs";
import { ScreenContextCard } from "./ScreenContextCard";
import { SessionCard } from "./SessionCard";
import { TopHostsCard } from "./TopHostsCard";
import { CapabilityCard } from "./CapabilityCard";
import { ModeSwitchCard } from "./ModeSwitchCard";
import { Icon } from "../../icons";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export function RightRail() {
  const { isCollapsed, isMobileOpen, activeTab, closeMobile } = useSidebar();
  const { screen } = useEvidenceNavigation();

  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Auto-close mobile drawer on route navigation
  useEffect(() => {
    if (isMobileOpen) {
      closeMobile();
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Body scroll lock and focus management for mobile drawer
  useEffect(() => {
    if (isMobileOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;

      // Lock body scroll
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      // Move focus into mobile drawer close button
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      } else if (drawerRef.current) {
        drawerRef.current.focus();
      }

      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeMobile();
          return;
        }

        // Trap focus inside drawer
        if (e.key === "Tab" && drawerRef.current) {
          const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;

          const first = focusables[0];
          const last = focusables[focusables.length - 1];

          if (first && last) {
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = originalOverflow;
        if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
          previousFocusRef.current.focus();
        }
      };
    }
  }, [isMobileOpen, closeMobile]);

  return (
    <>
      {/* Mobile / Tablet Overlay Backdrop */}
      <div
        className={isMobileOpen ? "np-rail-backdrop np-rail-backdrop--open" : "np-rail-backdrop"}
        onClick={closeMobile}
        aria-hidden="true"
      />

      {/* Main Right Rail Container */}
      <aside
        id="netpulse-right-rail"
        ref={drawerRef}
        tabIndex={-1}
        className={`np-rail-right ${isCollapsed ? "np-rail-right--collapsed" : ""} ${
          isMobileOpen ? "np-rail-right--mobile-open" : ""
        }`}
        aria-label="Context"
        aria-hidden={window.innerWidth <= 1120 ? !isMobileOpen : false}
      >
        {/* Mobile Header with Explicit Close Button */}
        <div className="np-rail-mobile-header">
          <span className="np-rail-mobile-header__title">NetPulse Context</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="np-iconbtn np-rail-mobile-header__close"
            onClick={closeMobile}
            aria-label="Close side panel"
            title="Close"
          >
            <Icon name="close" />
          </button>
        </div>

        {/* Desktop Header with Tabs */}
        {!isCollapsed && (
          <div className="np-rail-header">
            <RightRailTabs isCollapsed={isCollapsed} />
          </div>
        )}



        {/* Expanded Content Panels */}
        {!isCollapsed && (
          <div className="np-rail-content">
            {activeTab === "context" && (
              <div id="tabpanel-context" className="np-rail-tabpanel" role="tabpanel" aria-labelledby="tab-context">
                <ScreenContextCard />
              </div>
            )}

            {activeTab === "session" && (
              <div id="tabpanel-session" className="np-rail-tabpanel" role="tabpanel" aria-labelledby="tab-session">
                <SessionCard />
                <TopHostsCard />
              </div>
            )}

            {activeTab === "system" && (
              <div id="tabpanel-system" className="np-rail-tabpanel" role="tabpanel" aria-labelledby="tab-system">
                <CapabilityCard />
                <ModeSwitchCard />
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
