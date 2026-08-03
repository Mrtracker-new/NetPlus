import type { MonitoringWidget, DashboardZone } from "./monitoringTypes";

export class MonitoringWidgetRegistry {
  private widgets: Map<string, MonitoringWidget> = new Map();

  public register(widget: MonitoringWidget): void {
    this.widgets.set(widget.id, widget);
    widget.onInit?.();
  }

  public unregister(id: string): void {
    const widget = this.widgets.get(id);
    if (widget) {
      widget.onCleanup?.();
      this.widgets.delete(id);
    }
  }

  public getWidgetsForZone(zone: DashboardZone): MonitoringWidget[] {
    return Array.from(this.widgets.values())
      .filter((w) => w.placement === zone)
      .sort((a, b) => a.priority - b.priority);
  }

  public getAllWidgets(): MonitoringWidget[] {
    return Array.from(this.widgets.values()).sort((a, b) => a.priority - b.priority);
  }
}

export const widgetRegistry = new MonitoringWidgetRegistry();
