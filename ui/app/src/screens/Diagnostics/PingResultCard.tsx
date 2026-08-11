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

  const avgRtt = result.avgRttMs ?? 0;
  const isHighLoss = lossPct > 10;

  const statusLabel = isHighLoss
    ? "Loss Detected"
    : avgRtt > 100
    ? "High Latency"
    : avgRtt >= 30
    ? "Normal Latency"
    : "Optimal Latency";

  const statusColorVar =
    isHighLoss || avgRtt > 100
      ? "var(--np-finding)"
      : avgRtt >= 30
      ? "var(--np-notable)"
      : "var(--np-good)";

  const statusBgVar =
    isHighLoss || avgRtt > 100
      ? "var(--np-finding-soft)"
      : avgRtt >= 30
      ? "var(--np-notable-soft)"
      : "var(--np-good-soft)";

  return (
    <div
      className="np-diagnostics__result"
      style={{
        background: "var(--np-surface-1)",
        border: "1px solid var(--np-border)",
        borderRadius: "var(--np-radius-lg)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "var(--np-neu)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("ping.title", { target: result.target })}
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              padding: "0.2rem 0.6rem",
              borderRadius: "var(--np-radius-pill)",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: statusBgVar,
              color: statusColorVar,
              border: `1px solid ${statusColorVar}`,
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

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
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: isHighLoss ? "var(--np-finding)" : "var(--np-good)" }}>
            {lossPct}%
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Avg RTT</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: "var(--np-accent)" }}>
            {avgRttStr}ms
          </div>
        </div>
        <div className="np-kpi">
          <div className="np-kpi__label">Jitter</div>
          <div className="np-kpi__value" style={{ fontSize: "1.1rem", color: "var(--np-notable)" }}>
            {jitterStr}ms
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          color: "var(--np-subtext)",
          fontFamily: "monospace",
          background: "var(--np-bg)",
          padding: "0.5rem 0.75rem",
          borderRadius: "var(--np-radius-xs)",
          boxShadow: "var(--np-neu-inset)",
        }}
      >
        Min: {minRttStr}ms · Avg: {avgRttStr}ms · Max: {maxRttStr}ms
      </div>
    </div>
  );
}
