import { useTranslation } from "react-i18next";
import type { SessionDiff } from "@netpulse/contract";
import { Badge } from "@netpulse/components";

export interface CompareScorecardsProps {
  diff: SessionDiff;
}

export function CompareScorecards({ diff }: CompareScorecardsProps) {
  const { t } = useTranslation(["compare"]);

  const rttColor = diff.rttDeltaMs > 0 ? "#ef4444" : diff.rttDeltaMs < 0 ? "#10b981" : "var(--np-text, #e2e8f0)";
  const ttfbColor = diff.ttfbDeltaMs > 0 ? "#ef4444" : diff.ttfbDeltaMs < 0 ? "#10b981" : "var(--np-text, #e2e8f0)";

  const confUpper = (diff.confidence || "MEDIUM").toUpperCase();
  const confColor = confUpper === "HIGH" ? "#10b981" : confUpper === "MEDIUM" ? "#f59e0b" : "#ef4444";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: "0.85rem",
        marginBottom: "1.25rem",
      }}
    >
      {/* RTT Delta */}
      <div className="np-kpi" style={{ background: "var(--np-bg, #0b1019)", padding: "0.85rem 1rem", borderRadius: "var(--np-radius-md, 8px)" }}>
        <div className="np-kpi__label">{t("metrics.rtt_delta")}</div>
        <div className="np-kpi__value" style={{ color: rttColor, fontSize: "1.15rem", fontWeight: 700 }}>
          {diff.rttDeltaMs > 0 ? `+${diff.rttDeltaMs}` : diff.rttDeltaMs} ms
        </div>
      </div>

      {/* TTFB Delta */}
      <div className="np-kpi" style={{ background: "var(--np-bg, #0b1019)", padding: "0.85rem 1rem", borderRadius: "var(--np-radius-md, 8px)" }}>
        <div className="np-kpi__label">{t("metrics.ttfb_delta")}</div>
        <div className="np-kpi__value" style={{ color: ttfbColor, fontSize: "1.15rem", fontWeight: 700 }}>
          {diff.ttfbDeltaMs > 0 ? `+${diff.ttfbDeltaMs}` : diff.ttfbDeltaMs} ms
        </div>
      </div>

      {/* Protocol Shift */}
      <div className="np-kpi" style={{ background: "var(--np-bg, #0b1019)", padding: "0.85rem 1rem", borderRadius: "var(--np-radius-md, 8px)" }}>
        <div className="np-kpi__label">{t("metrics.protocol_shift")}</div>
        <div className="np-kpi__value" style={{ fontSize: "0.95rem", color: "var(--np-accent, #2fe0d6)" }}>
          {diff.protocolShift || "Unchanged"}
        </div>
      </div>

      {/* Confidence Badge */}
      <div className="np-kpi" style={{ background: "var(--np-bg, #0b1019)", padding: "0.85rem 1rem", borderRadius: "var(--np-radius-md, 8px)" }}>
        <div className="np-kpi__label">{t("metrics.confidence")}</div>
        <div style={{ marginTop: "0.25rem" }}>
          <Badge variant="kind" style={{ background: confColor, color: "#000", fontWeight: 700 }}>
            {confUpper}
          </Badge>
        </div>
      </div>
    </div>
  );
}
