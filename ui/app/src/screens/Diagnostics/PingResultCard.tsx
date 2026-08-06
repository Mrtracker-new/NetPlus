import { useTranslation } from "react-i18next";
import { formatMs, type ExtendedPingResult } from "../../hooks/useDiagnosticsController";

export interface PingResultCardProps {
  result: ExtendedPingResult;
}

export function PingResultCard({ result }: PingResultCardProps) {
  const { t } = useTranslation(["diagnostics"]);

  const lossPct = Math.round((result.lossPct ?? 0) * 10) / 10;
  const avgRttStr = formatMs(result.avgRttMs ?? 0);
  const minRttStr = formatMs(result.minRttMs ?? 0);
  const maxRttStr = formatMs(result.maxRttMs ?? 0);
  const jitterStr = formatMs(result.jitterMs ?? 0);

  const isHighLoss = lossPct > 10;

  return (
    <div
      className="np-diagnostics__result"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        {t("ping.title", { target: result.target })}
      </h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div className="np-kpi">
          <div className="np-kpi__label">Sent / Received</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem" }}>
            {result.sent} / {result.received}
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Loss</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: isHighLoss ? "#ef4444" : "#10b981" }}>
            {lossPct}%
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Avg RTT</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: "var(--np-accent, #2fe0d6)" }}>
            {avgRttStr}ms
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Jitter</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: "var(--np-warning, #ffb800)" }}>
            {jitterStr}ms
          </div>
        </div>
      </div>

      <div style={{ fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", fontFamily: "monospace" }}>
        Min: {minRttStr}ms · Avg: {avgRttStr}ms · Max: {maxRttStr}ms
      </div>
    </div>
  );
}
