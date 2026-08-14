import { useSidebar } from "./useSidebar";
import { Icon } from "../../icons";

export function RightRailToggle() {
  const { isCollapsed, isMobileOpen, toggleCollapsed, toggleMobile } = useSidebar();

  function handleClick() {
    if (window.innerWidth <= 1120) {
      toggleMobile();
    } else {
      toggleCollapsed();
    }
  }

  const isExpanded = window.innerWidth <= 1120 ? isMobileOpen : !isCollapsed;

  return (
    <button
      type="button"
      className={isExpanded ? "np-iconbtn np-sidebar-toggle np-sidebar-toggle--active" : "np-iconbtn np-sidebar-toggle"}
      onClick={handleClick}
      aria-label={isExpanded ? "Collapse side panel" : "Expand side panel"}
      aria-controls="netpulse-right-rail"
      aria-expanded={isExpanded}
      title={isExpanded ? "Collapse side panel (Ctrl+\\)" : "Expand side panel (Ctrl+\\)"}
    >
      <Icon name="sidebar" />
    </button>
  );
}
