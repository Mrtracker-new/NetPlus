import { useTranslation } from "react-i18next";

export interface DisclosurePanelProps {
  disclosure: string;
}

export function DisclosurePanel({ disclosure }: DisclosurePanelProps) {
  const { t } = useTranslation(["assistant"]);

  return (
    <details className="np-assistant__disclosure">
      <summary>
        {t("posture.disclosure_summary")}
      </summary>

      <div className="np-assistant__disclosure-panel">
        <div className="np-assistant__disclosure-grid">
          <div>
            <div className="np-assistant__disclosure-col-title np-assistant__disclosure-col-title--inc">
              {t("disclosure.included")}
            </div>
            <ul className="np-assistant__disclosure-list">
              <li>{t("disclosure.inc_flow")}</li>
              <li>{t("disclosure.inc_dns")}</li>
              <li>{t("disclosure.inc_timing")}</li>
              <li>{t("disclosure.inc_proto")}</li>
            </ul>
          </div>

          <div>
            <div className="np-assistant__disclosure-col-title np-assistant__disclosure-col-title--exc">
              {t("disclosure.excluded")}
            </div>
            <ul className="np-assistant__disclosure-list">
              <li>{t("disclosure.exc_payloads")}</li>
              <li>{t("disclosure.exc_files")}</li>
              <li>{t("disclosure.exc_creds")}</li>
            </ul>
          </div>
        </div>

        {disclosure && (
          <pre className="np-assistant__disclosure-body">
            {disclosure}
          </pre>
        )}
      </div>
    </details>
  );
}

