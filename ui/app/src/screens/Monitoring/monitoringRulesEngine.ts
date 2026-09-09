import type {
  DomainTelemetry,
  ActiveAlert,
  SubsystemStatus,
  IntelligentRecommendation,
} from "./monitoringTypes";

/**
 * @deprecated Client-side heuristic rules engine evaluation is deprecated.
 * Authoritative diagnostic hypotheses and subsystem health are now produced directly
 * by the Rust backend via `telemetry.diagnoses` and `telemetry.subsystems`.
 * Synthetic alert and recommendation generators have been retired.
 */
export interface DiagnosticsEvaluation {
  alerts: ActiveAlert[];
  subsystems: SubsystemStatus[];
  recommendations: IntelligentRecommendation[];
}

/**
 * @deprecated Client-side heuristic rules engine evaluation is deprecated.
 * Authoritative diagnostic hypotheses and subsystem health are now produced directly
 * by the Rust backend via `telemetry.diagnoses` and `telemetry.subsystems`.
 * Synthetic alert and recommendation generators have been retired.
 */
export function evaluateDiagnosticsRules(
  telemetry: DomainTelemetry,
  _awaitingInitialTelemetry?: boolean
): DiagnosticsEvaluation {
  // Authoritative Subsystem Health Checks from Rust Backend
  const subsystems: SubsystemStatus[] =
    telemetry?.subsystems && telemetry.subsystems.length > 0
      ? [...telemetry.subsystems]
      : [];

  // Synthetic alert and recommendation generators are retired.
  // Authoritative diagnoses are provided directly via telemetry.diagnoses.
  return {
    alerts: [],
    subsystems,
    recommendations: [],
  };
}

