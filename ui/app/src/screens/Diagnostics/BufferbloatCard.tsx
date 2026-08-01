import { useTranslation } from "react-i18next";
import type { BufferbloatResult } from "@netpulse/contract";
import { useDisclosure } from "../../modes/DisclosureContext";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface BufferbloatCardProps {
  target: string;
  result: BufferbloatResult;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "#10b981",
  A: "#10b981",
  B: "#f59e0b",
  C: "#f59e0b",
  D: "#ef4444",
  F: "#ef4444",
};

export function BufferbloatCard({ target, result }: BufferbloatCardProps) {
  const { t } = useTranslation(["diagnostics"]);
  const { shows } = useDisclosure();

  const idleRttStr = formatMs(result.idleRttMs ?? result.idle_rtt_ms ?? 0);
  const loadedRttStr = formatMs(result.loadedRttMs ?? result.loaded_rtt_ms ?? 0);
  const deltaRttStr = formatMs(result.deltaRttMs ?? result.delta_rtt_ms ?? 0);

  const gradeColor = GRADE_COLORS[result.grade] ?? "#10b981";

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
        background: "var(--np-surface-1, #131b2a)",
        border: `1px solid ${gradeColor}`,
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          {t("bufferbloat.title", { target })}
        </h3>

        {/* Grade Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--np-muted, #8b9bb4)" }}>{t("bufferbloat.grade")}</span>
          <span
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "1.25rem",
              fontWeight: 800,
              borderRadius: "var(--np-radius-md, 8px)",
              background: gradeColor,
              color: "#000",
            }}
          >
            {result.grade}
          </span>
        </div>
      </div>

      {shows("intermediate") && (
        <div style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "1rem" }}>
          {t("bufferbloat.idle_rtt", { idle: idleRttStr })} ·{" "}
          {t("bufferbloat.loaded_rtt", { loaded: loadedRttStr })} ·{" "}
          <span style={{ color: "var(--np-warning, #ffb800)", fontWeight: 600 }}>
            {t("bufferbloat.delta_rtt", { delta: deltaRttStr })}
          </span>
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
