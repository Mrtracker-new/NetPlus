import { useTranslation } from "react-i18next";

export interface DisclosurePanelProps {
  disclosure: string;
}

export function DisclosurePanel({ disclosure }: DisclosurePanelProps) {
  const { t } = useTranslation(["assistant"]);

  return (
    <details className="np-assistant__disclosure" style={{ marginTop: "0.85rem", fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)" }}>
      <summary style={{ cursor: "pointer", fontWeight: 500 }}>
        {t("posture.disclosure_summary")}
      </summary>

      <div style={{ marginTop: "0.5rem", background: "var(--np-bg, #0b1019)", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))", borderRadius: "var(--np-radius-md, 6px)", padding: "0.75rem 1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "0.75rem" }}>
          <div>
            <div style={{ fontWeight: 600, color: "#10b981", marginBottom: "0.25rem" }}>
              {t("disclosure.included")}
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
              <li>{t("disclosure.inc_flow")}</li>
              <li>{t("disclosure.inc_dns")}</li>
              <li>{t("disclosure.inc_timing")}</li>
              <li>{t("disclosure.inc_proto")}</li>
            </ul>
          </div>

          <div>
            <div style={{ fontWeight: 600, color: "#ef4444", marginBottom: "0.25rem" }}>
              {t("disclosure.excluded")}
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
              <li>{t("disclosure.exc_payloads")}</li>
              <li>{t("disclosure.exc_files")}</li>
              <li>{t("disclosure.exc_creds")}</li>
            </ul>
          </div>
        </div>

        {disclosure && (
          <pre
            className="np-assistant__disclosure-body"
            style={{ margin: 0, padding: "0.5rem", background: "rgba(0,0,0,0.3)", borderRadius: "4px", fontSize: "0.78rem", whiteSpace: "pre-wrap" }}
          >
            {disclosure}
          </pre>
        )}
      </div>
    </details>
  );
}
