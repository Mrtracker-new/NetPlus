import { useTranslation } from "react-i18next";
import type { BufferbloatResult } from "@netpulse/contract";
import { useDisclosure } from "../../modes/DisclosureContext";
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
  const { shows } = useDisclosure();

  const idleRttStr = formatMs(result.idleRttMs ?? 0);
  const loadedRttStr = formatMs(result.loadedRttMs ?? 0);
  const deltaRttStr = formatMs(result.deltaRttMs ?? 0);

  const gradeColor = GRADE_COLORS[result.grade] ?? "var(--np-good)";

  const recommendations =
    result.grade === "A+" || result.grade === "A"
      ? { gaming: "Excellent", voip: "Excellent", uploads: "Excellent" }
      : result.grade === "B" || result.grade === "C"
      ? { gaming: "Moderate", voip: "Good", uploads: "Acceptable" }
      : { gaming: "Poor", voip: "Degraded", uploads: "Severe Lag" };

  return (
    <div
      className="np-diagnostics__result"
      style={{
        background: "var(--np-surface-1)",
        border: `1px solid ${gradeColor}`,
        borderRadius: "var(--np-radius-lg)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "var(--np-neu)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("bufferbloat.title", { target })}
        </h3>

        {/* Grade Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--np-text-dim)" }}>{t("bufferbloat.grade")}</span>
          <span
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "1.25rem",
              fontWeight: 800,
              borderRadius: "var(--np-radius-md)",
              background: gradeColor,
              color: "var(--np-on-accent, #000)",
            }}
          >
            {result.grade}
          </span>
        </div>
      </div>

      {shows("intermediate") && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.9rem", color: "var(--np-text-dim)", marginBottom: "0.75rem" }}>
            {t("bufferbloat.idle_rtt", { idle: idleRttStr })} ·{" "}
            {t("bufferbloat.loaded_rtt", { loaded: loadedRttStr })} ·{" "}
            <span style={{ color: "var(--np-notable)", fontWeight: 600 }}>
              {t("bufferbloat.delta_rtt", { delta: deltaRttStr })}
            </span>
          </div>

          {/* Latency Comparison Bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--np-text-mute)" }}>
                <span>Idle Latency</span>
                <span>{idleRttStr} ms</span>
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
                <span>Loaded Latency (Under Traffic)</span>
                <span>{loadedRttStr} ms (+{deltaRttStr} ms)</span>
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
      )}

      {/* Recommended Usage Guidance */}
      <div
        style={{
          background: "var(--np-bg, #0b1019)",
          padding: "0.75rem 1rem",
          borderRadius: "var(--np-radius-md, 8px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.5rem",
          fontSize: "0.8rem",
        }}
      >
        <div>
          <span style={{ color: "var(--np-muted, #8b9bb4)" }}>{t("bufferbloat.recommendations.gaming")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>{recommendations.gaming}</span>
        </div>
        <div>
          <span style={{ color: "var(--np-muted, #8b9bb4)" }}>{t("bufferbloat.recommendations.voip")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>{recommendations.voip}</span>
        </div>
        <div>
          <span style={{ color: "var(--np-muted, #8b9bb4)" }}>{t("bufferbloat.recommendations.uploads")} </span>
          <span style={{ fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>{recommendations.uploads}</span>
        </div>
      </div>
    </div>
  );
}
