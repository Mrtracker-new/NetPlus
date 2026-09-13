import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { BufferbloatResult } from "@netpulse/contract";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface BufferbloatCardProps {
  target?: string;
  result: BufferbloatResult;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "var(--np-good)",
  A: "var(--np-good)",
  B: "var(--np-notable)",
  C: "var(--np-notable)",
  D: "var(--np-finding)",
  F: "var(--np-finding)",
};

export const BufferbloatCard = memo(function BufferbloatCard({ target: propTarget, result }: BufferbloatCardProps) {
  const { t } = useTranslation(["diagnostics"]);

  const target = result.target || propTarget || "";

  const idleRttStr = formatMs(result.idleRttMs ?? 0);
  const loadedRttStr = formatMs(result.loadedRttMs ?? 0);
  const deltaRttStr = formatMs(result.deltaRttMs ?? 0);

  const gradeColor = GRADE_COLORS[result.grade] ?? "var(--np-good)";

  const sourceNormalized = (result.source ?? "").toLowerCase();
  const provenanceClass =
    sourceNormalized === "live"
      ? "np-diagnostics-provenance--live"
      : sourceNormalized === "simulated"
      ? "np-diagnostics-provenance--simulated"
      : sourceNormalized === "derived"
      ? "np-diagnostics-provenance--derived"
      : sourceNormalized === "unavailable"
      ? "np-diagnostics-provenance--unavailable"
      : "";

  const recKeys =
    result.grade === "A+" || result.grade === "A"
      ? { gaming: "excellent", voip: "excellent", uploads: "excellent" }
      : result.grade === "B" || result.grade === "C"
      ? { gaming: "moderate", voip: "good", uploads: "acceptable" }
      : { gaming: "poor", voip: "degraded", uploads: "severe_lag" };

  const defaultValues: Record<string, string> = {
    excellent: "Excellent",
    moderate: "Moderate",
    good: "Good",
    acceptable: "Acceptable",
    poor: "Poor",
    degraded: "Degraded",
    severe_lag: "Severe Lag",
  };

  const recommendations = {
    gaming: t(`bufferbloat.quality.${recKeys.gaming}`, defaultValues[recKeys.gaming]!),
    voip: t(`bufferbloat.quality.${recKeys.voip}`, defaultValues[recKeys.voip]!),
    uploads: t(`bufferbloat.quality.${recKeys.uploads}`, defaultValues[recKeys.uploads]!),
  };

  const headingId = "bufferbloat-card-title";

  return (
    <article className="np-diagnostics__result" aria-labelledby={headingId}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div>
          <h2 id={headingId} style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
            {t("bufferbloat.title", { target })}
          </h2>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {t("bufferbloat.subtitle")}
          </span>
        </div>

        {/* Tactile Grade Medallion & Provenance Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {result.source ? (
            <span
              className={`np-diagnostics-provenance ${provenanceClass}`.trim()}
              data-provenance={sourceNormalized}
            >
              {result.source}
            </span>
          ) : null}
          <span style={{ fontSize: "0.85rem", color: "var(--np-text-dim)", fontWeight: 500 }}>
            {t("bufferbloat.grade")}
          </span>
          <div
            className="np-diagnostics__grade-medallion"
            style={{
              background: `linear-gradient(145deg, var(--np-surface-2), var(--np-surface-1))`,
              color: gradeColor,
              border: `2px solid ${gradeColor}`,
              boxShadow: "var(--np-neu-sm)",
            }}
          >
            {result.grade}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div
          className="np-diagnostics-telemetry-strip"
          style={{ marginBottom: "0.75rem" }}
        >
          <span>{t("bufferbloat.idle_rtt", { idle: idleRttStr })}</span>
          <span style={{ opacity: 0.4 }} aria-hidden="true">·</span>
          <span>{t("bufferbloat.loaded_rtt", { loaded: loadedRttStr })}</span>
          <span style={{ opacity: 0.4 }} aria-hidden="true">·</span>
          <span style={{ color: "var(--np-notable)", fontWeight: 600 }}>
            {t("bufferbloat.delta_rtt", { delta: deltaRttStr })}
          </span>
        </div>

        {/* Level 3 Recessed Latency Comparison Bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--np-text-mute)" }}>
              <span>{t("bufferbloat.idle_baseline")}</span>
              <span style={{ fontFamily: "var(--np-font-mono)" }}>{idleRttStr} ms</span>
            </div>
            <div className="np-diagnostics__latency-bar">
              <div
                className="np-diagnostics__latency-fill"
                style={{
                  width: `${Math.min(100, Math.max(10, ((result.idleRttMs ?? 0) / Math.max(1, result.loadedRttMs ?? 1)) * 100))}%`,
                  background: "var(--np-accent)",
                }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--np-text-mute)" }}>
              <span>{t("bufferbloat.loaded_saturated")}</span>
              <span style={{ fontFamily: "var(--np-font-mono)", color: gradeColor, fontWeight: 600 }}>
                {loadedRttStr} ms (+{deltaRttStr} ms)
              </span>
            </div>
            <div className="np-diagnostics__latency-bar">
              <div
                className="np-diagnostics__latency-fill"
                style={{
                  width: "100%",
                  background: gradeColor,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recommended Usage Guidance */}
      <div className="np-diagnostics__recommendations">
        <div>
          <span style={{ color: "var(--np-text-mute)" }}>{t("bufferbloat.recommendations.gaming")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text)" }}>{recommendations.gaming}</span>
        </div>
        <div>
          <span style={{ color: "var(--np-text-mute)" }}>{t("bufferbloat.recommendations.voip")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text)" }}>{recommendations.voip}</span>
        </div>
        <div>
          <span style={{ color: "var(--np-text-mute)" }}>{t("bufferbloat.recommendations.uploads")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text)" }}>{recommendations.uploads}</span>
        </div>
      </div>
    </article>
  );
});
