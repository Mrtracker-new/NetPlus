import type { EngineState, StructuredError } from "./monitoringTypes";

const VALID_TRANSITIONS: Record<EngineState, EngineState[]> = {
  Initializing: ["Connecting", "Simulation", "Standby", "Error"],
  Connecting: ["Live", "Simulation", "Standby", "Degraded", "Reconnecting", "Disconnected", "Error"],
  Live: ["Paused", "Degraded", "Standby", "Disconnected", "Error"],
  Standby: ["Connecting", "Live", "Simulation", "Disconnected", "Error"],
  Paused: ["Live", "Standby", "Disconnected", "Error"],
  Degraded: ["Live", "Reconnecting", "Standby", "Disconnected", "Error"],
  Reconnecting: ["Live", "Degraded", "Standby", "Disconnected", "Simulation", "Error"],
  Simulation: ["Live", "Paused", "Standby", "Disconnected", "Error"],
  Disconnected: ["Connecting", "Live", "Reconnecting", "Standby", "Simulation", "Initializing", "Error"],
  Error: ["Initializing", "Connecting", "Standby", "Simulation", "Reconnecting"],
};

export class MonitoringStateMachine {
  private currentState: EngineState = "Initializing";
  private currentError: StructuredError | null = null;

  public getState(): EngineState {
    return this.currentState;
  }

  public getError(): StructuredError | null {
    return this.currentError;
  }

  public transitionTo(
    nextState: EngineState,
    error: StructuredError | null = null
  ): boolean {
    if (nextState === this.currentState) {
      this.currentError = error;
      return true;
    }
    const allowed = VALID_TRANSITIONS[this.currentState];
    if (allowed && allowed.includes(nextState)) {
      this.currentState = nextState;
      this.currentError = error;
      return true;
    }
    console.warn(
      `[MonitoringFSM] Invalid state transition requested: ${this.currentState} -> ${nextState}`
    );
    return false;
  }

  public forceState(state: EngineState, error: StructuredError | null = null): void {
    this.currentState = state;
    this.currentError = error;
  }
}
