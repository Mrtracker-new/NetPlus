import { useTranslation } from "react-i18next";
import type { BufferbloatResult } from "@netpulse/contract";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface BufferbloatCardProps {
  target: string;
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

export function BufferbloatCard({ target, result }: BufferbloatCardProps) {
  const { t } = useTranslation(["diagnostics"]);

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

  const recommendations =
    result.grade === "A+" || result.grade === "A"
      ? { gaming: "Excellent", voip: "Excellent", uploads: "Excellent" }
      : result.grade === "B" || result.grade === "C"
      ? { gaming: "Moderate", voip: "Good", uploads: "Acceptable" }
      : { gaming: "Poor", voip: "Degraded", uploads: "Severe Lag" };

  return (
    <article className="np-diagnostics__result" aria-label={t("bufferbloat.title", { target })}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
            {t("bufferbloat.title", { target })}
          </h3>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-dim)" }}>
            {t("bufferbloat.subtitle")}
          </span>
        </div>

        {/* Tactile Grade Medallion & Provenance Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {result.source && (
            <span
              className={`np-diagnostics-provenance ${provenanceClass}`}
              data-provenance={result.source}
            >
              {result.source}
            </span>
          )}
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
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{t("bufferbloat.loaded_rtt", { loaded: loadedRttStr })}</span>
          <span style={{ opacity: 0.4 }}>·</span>
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
}
