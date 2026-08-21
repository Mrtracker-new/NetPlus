import { useTranslation } from "react-i18next";
import type { ExportPreview } from "@netpulse/contract";
import { Icon } from "../../icons";
import { ExportSummaryKpis } from "./ExportSummaryKpis";

export interface ExportPreviewCardProps {
  preview: ExportPreview;
}

export function ExportPreviewCard({ preview }: ExportPreviewCardProps) {
  const { t } = useTranslation(["export"]);

  const formattedLevel = preview.level.replace("_", "-");

  const displayProvenance = preview.provenance.includes(" · ")
    ? `${preview.provenance.split(" · ")[0]} · ${formattedLevel}`
    : `NetPulse 0.1.0 · ${formattedLevel}`;

  const levelSanitizationRule =
    preview.level === "full_payload"
      ? "full payload: packet payloads included"
      : preview.level === "headers"
      ? "headers only: transport & IP headers included, application body stripped"
      : "metadata-only: no packet payloads leave";

  const displaySanitized = [
    levelSanitizationRule,
    ...preview.sanitized.filter(
      (rule) =>
        !rule.startsWith("metadata-only") &&
        !rule.startsWith("headers only") &&
        !rule.startsWith("full payload")
    ),
  ];

  return (
    <div className="np-export__preview-card">
      <h3 className="np-export__preview-title">
        {t("preview.title")}
      </h3>

      <ExportSummaryKpis flows={preview.flows} sessions={preview.sessions} hosts={preview.hosts} />

      <div className="np-export__preview-meta">
        <div>
          {t("preview.level", { level: preview.level.replace("_", " ") })}{" "}
          <strong style={{ color: preview.contains_payloads ? "var(--np-notable)" : "var(--np-good)" }}>
            {preview.contains_payloads ? t("preview.contains_payloads") : t("preview.no_payloads")}
          </strong>
        </div>

        <div className="np-export__provenance" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <Icon name="pin" style={{ width: "13px", height: "13px" }} />
          <span>{displayProvenance}</span>
        </div>
      </div>

      {displaySanitized.length > 0 && (
        <details className="np-export__sanitized">
          <summary>
            {t("preview.sanitization_title")} ({displaySanitized.length})
          </summary>
          <ul className="np-export__sanitized-list">
            {displaySanitized.map((rule, idx) => (
              <li key={idx} className="np-export__sanitized-item">
                {rule}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

