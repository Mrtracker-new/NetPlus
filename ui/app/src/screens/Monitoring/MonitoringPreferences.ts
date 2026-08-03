import type { DashboardTimeRange } from "./monitoringTypes";

export interface UserPreferences {
  timeRange: DashboardTimeRange;
  selectedRulesFilter: string;
  selectedNodeId: string | null;
  collapsedPanels: Record<string, boolean>;
}

const STORAGE_KEY = "netpulse_monitoring_preferences_v1";

const DEFAULT_PREFERENCES: UserPreferences = {
  timeRange: "1h",
  selectedRulesFilter: "Custom Rules",
  selectedNodeId: null,
  collapsedPanels: {},
};

export class MonitoringPreferencesManager {
  private preferences: UserPreferences;

  constructor() {
    this.preferences = this.load();
  }

  public getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  public setTimeRange(timeRange: DashboardTimeRange): void {
    this.preferences.timeRange = timeRange;
    this.save();
  }

  public setRulesFilter(filter: string): void {
    this.preferences.selectedRulesFilter = filter;
    this.save();
  }

  public setSelectedNodeId(nodeId: string | null): void {
    this.preferences.selectedNodeId = nodeId;
    this.save();
  }

  public togglePanelCollapse(panelId: string): void {
    const current = !!this.preferences.collapsedPanels[panelId];
    this.preferences.collapsedPanels[panelId] = !current;
    this.save();
  }

  private load(): UserPreferences {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const item = window.localStorage.getItem(STORAGE_KEY);
        if (item) return { ...DEFAULT_PREFERENCES, ...JSON.parse(item) };
      }
    } catch {
      // Fallback
    }
    return DEFAULT_PREFERENCES;
  }

  private save(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
      }
    } catch {
      // Fallback
    }
  }
}

export const preferencesManager = new MonitoringPreferencesManager();
