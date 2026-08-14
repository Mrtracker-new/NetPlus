import { useSidebar, type RightRailTab } from "./useSidebar";
import { Icon } from "../../icons";

const TABS: { id: RightRailTab; label: string; icon: "context" | "session" | "system" }[] = [
  { id: "context", label: "Context", icon: "context" },
  { id: "session", label: "Session", icon: "session" },
  { id: "system", label: "System", icon: "system" },
];

export function RightRailTabs({ isCollapsed }: { isCollapsed?: boolean }) {
  const { activeTab, setActiveTab, setCollapsed } = useSidebar();

  function handleSelect(id: RightRailTab) {
    if (isCollapsed) {
      setActiveTab(id);
      setCollapsed(false);
    } else {
      setActiveTab(id);
    }
  }

  return (
    <div className="np-rail-tabs" role="tablist" aria-label="Sidebar view tabs">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            className={isActive ? "np-rail-tab np-rail-tab--active" : "np-rail-tab"}
            onClick={() => handleSelect(tab.id)}
            title={tab.label}
          >
            <Icon name={tab.icon} />
            <span className="np-rail-tab__label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
