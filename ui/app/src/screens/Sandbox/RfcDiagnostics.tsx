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

const SEVERITY_VARIANTS: Record<DiagnosticSeverity, { token: string; bgSoft: string }> = {
  error: { token: "var(--np-finding)", bgSoft: "var(--np-finding-soft)" },
  warning: { token: "var(--np-notable)", bgSoft: "var(--np-notable-soft)" },
  info: { token: "var(--np-good)", bgSoft: "var(--np-good-soft)" },
};

export function RfcDiagnostics({ diagnostics }: RfcDiagnosticsProps) {
  const { t } = useTranslation(["sandbox"]);

  return (
    <article className="np-sandbox__card" style={{ marginTop: "1.5rem" }} aria-label={t("rfc_diagnostics")}>
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text)" }}>
        {t("rfc_diagnostics")}
      </h3>

      {diagnostics.length === 0 ? (
        <p style={{ margin: 0, color: "var(--np-subtext)", fontSize: "0.9rem" }}>
          {t("no_diagnostics")}
        </p>
      ) : (
        <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {diagnostics.map((d, idx) => {
            const { token, bgSoft } = SEVERITY_VARIANTS[d.severity] ?? SEVERITY_VARIANTS.info;
            return (
              <li
                key={idx}
                className="np-sandbox__diag"
                role="listitem"
                style={{
                  background: "var(--np-bg)",
                  borderLeft: `4px solid ${token}`,
                  borderRadius: "var(--np-radius-md)",
                  padding: "0.75rem 1rem",
                }}
              >
                <header
                  className="np-sandbox__diag-head"
                  style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}
                >
                  <Badge variant="kind" style={{ background: bgSoft, color: token, border: `1px solid ${token}`, fontWeight: 700 }}>
                    {d.severity.toUpperCase()}
                  </Badge>
                  <strong style={{ fontSize: "0.9rem", color: "var(--np-text)" }}>{d.field}</strong>
                  <span style={{ fontSize: "0.8rem", color: "var(--np-muted)", fontFamily: "monospace" }}>
                    ({d.rfcReference})
                  </span>
                </header>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--np-subtext)" }}>
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
