import { useTranslation } from "react-i18next";
import type { SessionDiff } from "@netpulse/contract";
import { Badge } from "@netpulse/components";

export interface CompareScorecardsProps {
  diff: SessionDiff;
}

export function CompareScorecards({ diff }: CompareScorecardsProps) {
  const { t } = useTranslation(["compare"]);

  const rttColor = diff.rttDeltaMs > 0 ? "var(--np-finding)" : diff.rttDeltaMs < 0 ? "var(--np-good)" : "var(--np-text)";
  const ttfbColor = diff.ttfbDeltaMs > 0 ? "var(--np-finding)" : diff.ttfbDeltaMs < 0 ? "var(--np-good)" : "var(--np-text)";

  const confUpper = (diff.confidence || "MEDIUM").toUpperCase();
  const confColor = confUpper === "HIGH" ? "var(--np-good)" : confUpper === "MEDIUM" ? "var(--np-notable)" : "var(--np-finding)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.85rem",
        marginBottom: "1.25rem",
      }}
    >
      {/* RTT Delta */}
      <div className="np-session-diff__metric-card">
        <div className="np-session-diff__metric-label">{t("metrics.rtt_delta")}</div>
        <div className="np-session-diff__metric-val" style={{ color: rttColor, fontSize: "1.15rem", fontWeight: 700 }}>
          {diff.rttDeltaMs > 0 ? `+${diff.rttDeltaMs}` : diff.rttDeltaMs} ms
        </div>
      </div>

      {/* TTFB Delta */}
      <div className="np-session-diff__metric-card">
        <div className="np-session-diff__metric-label">{t("metrics.ttfb_delta")}</div>
        <div className="np-session-diff__metric-val" style={{ color: ttfbColor, fontSize: "1.15rem", fontWeight: 700 }}>
          {diff.ttfbDeltaMs > 0 ? `+${diff.ttfbDeltaMs}` : diff.ttfbDeltaMs} ms
        </div>
      </div>

      {/* Protocol Shift */}
      <div className="np-session-diff__metric-card">
        <div className="np-session-diff__metric-label">{t("metrics.protocol_shift")}</div>
        <div className="np-session-diff__metric-val" style={{ fontSize: "0.95rem", color: "var(--np-accent)" }}>
          {diff.protocolShift || "Unchanged"}
        </div>
      </div>

      {/* Confidence Badge */}
      <div className="np-session-diff__metric-card">
        <div className="np-session-diff__metric-label">{t("metrics.confidence")}</div>
        <div style={{ marginTop: "0.35rem" }}>
          <Badge variant="kind" style={{ background: confColor, color: "var(--np-bg)", fontWeight: 700, padding: "0.25rem 0.65rem", boxShadow: "var(--np-neu-sm)" }}>
            {confUpper}
          </Badge>
        </div>
      </div>
    </div>
  );
}
