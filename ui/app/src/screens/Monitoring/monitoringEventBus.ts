import type { MonitoringEvents } from "./monitoringTypes";

export class MonitoringEventBus {
  private listeners = new Map<string, Set<(data: any) => void>>();

  public on<K extends keyof MonitoringEvents>(
    event: K,
    handler: (data: MonitoringEvents[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  public emit<K extends keyof MonitoringEvents>(
    event: K,
    data: MonitoringEvents[K]
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((fn) => fn(data));
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear();
  }
}

export const monitoringEventBus = new MonitoringEventBus();
