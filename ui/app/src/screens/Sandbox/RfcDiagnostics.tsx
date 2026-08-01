import { useTranslation } from "react-i18next";
import type { DiagnosticSeverity } from "@netpulse/contract";
import { Badge } from "@netpulse/components";

export interface DiagnosticItem {
  field: string;
  severity: DiagnosticSeverity;
  rfcReference: string;
  explanation: string;
}

export interface RfcDiagnosticsProps {
  diagnostics: readonly DiagnosticItem[];
}

const SEVERITY_COLORS: Record<DiagnosticSeverity, string> = {
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#1ea39c",
};

export function RfcDiagnostics({ diagnostics }: RfcDiagnosticsProps) {
  const { t } = useTranslation(["sandbox"]);

  return (
    <article
      className="np-sandbox__panel"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginTop: "1.5rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        {t("rfc_diagnostics")}
      </h3>

      {diagnostics.length === 0 ? (
        <p className="np-sandbox__desc" style={{ color: "var(--np-subtext, #94a3b8)", fontSize: "0.9rem" }}>
          {t("no_diagnostics")}
        </p>
      ) : (
        <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {diagnostics.map((d, idx) => {
            const badgeColor = SEVERITY_COLORS[d.severity] ?? "#1ea39c";
            return (
              <li
                key={idx}
                className="np-sandbox__diag"
                role="listitem"
                style={{
                  background: "var(--np-bg, #0b1019)",
                  borderLeft: `4px solid ${badgeColor}`,
                  borderRadius: "var(--np-radius-md, 8px)",
                  padding: "0.75rem 1rem",
                }}
              >
                <header
                  className="np-sandbox__diag-head"
                  style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}
                >
                  <Badge variant="kind" style={{ background: badgeColor, color: "#000", fontWeight: 700 }}>
                    {d.severity.toUpperCase()}
                  </Badge>
                  <strong style={{ fontSize: "0.9rem", color: "var(--np-text, #e2e8f0)" }}>{d.field}</strong>
                  <span style={{ fontSize: "0.8rem", color: "var(--np-muted, #8b9bb4)", fontFamily: "monospace" }}>
                    ({d.rfcReference})
                  </span>
                </header>
                <p className="np-sandbox__diag-desc" style={{ margin: 0, fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)" }}>
                  {d.explanation}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
