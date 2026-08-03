import { CircularBuffer } from "./CircularBuffer";
import { MonitoringStateMachine } from "./MonitoringStateMachine";
import { monitoringEventBus } from "./monitoringEventBus";
import { generateIdleTelemetry } from "./monitoringMock";
import type { DomainTelemetry, EngineState } from "./monitoringTypes";

export class MonitoringService {
  private stateMachine = new MonitoringStateMachine();
  private ingressBuffer = new CircularBuffer<number>(300);
  private egressBuffer = new CircularBuffer<number>(300);
  private gainsBuffer = new CircularBuffer<number>(300);

  constructor() {
    this.stateMachine.forceState("Standby");
  }

  public start(): void {
    // When capture is not running, service stays in Standby zero-state baseline
    if (this.stateMachine.getState() !== "Live") {
      this.stateMachine.transitionTo("Standby");
      this.emitStateChange();
      monitoringEventBus.emit("telemetryUpdated", generateIdleTelemetry());
    }
  }

  public stop(): void {
    this.stateMachine.transitionTo("Standby");
    this.emitStateChange();
    monitoringEventBus.emit("telemetryUpdated", generateIdleTelemetry());
  }

  public pause(): void {
    this.stateMachine.transitionTo("Paused");
    this.emitStateChange();
  }

  public resume(): void {
    this.stateMachine.transitionTo("Standby");
    this.emitStateChange();
  }

  public getEngineState(): EngineState {
    return this.stateMachine.getState();
  }

  public getEngineError() {
    return this.stateMachine.getError();
  }

  public setBackendTelemetry(telemetry: DomainTelemetry): void {
    this.stateMachine.transitionTo("Live");
    this.emitStateChange();

    this.ingressBuffer.push(
      telemetry.ingressHistory[telemetry.ingressHistory.length - 1] ?? 0
    );
    this.egressBuffer.push(
      telemetry.egressHistory[telemetry.egressHistory.length - 1] ?? 0
    );
    this.gainsBuffer.push(
      telemetry.gainsHistory[telemetry.gainsHistory.length - 1] ?? 0
    );

    monitoringEventBus.emit("telemetryUpdated", telemetry);
  }

  private emitStateChange(): void {
    monitoringEventBus.emit("engineStateChanged", {
      state: this.stateMachine.getState(),
      error: this.stateMachine.getError() || undefined,
    });
  }
}

export const monitoringService = new MonitoringService();
