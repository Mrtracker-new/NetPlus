import { useTranslation } from "react-i18next";
import type { ExportPreview } from "@netpulse/contract";
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
    <div
      className="np-export__preview"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        📋 {t("preview.title")}
      </h3>

      <ExportSummaryKpis flows={preview.flows} sessions={preview.sessions} hosts={preview.hosts} />

      <div style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.75rem" }}>
        <span>
          {t("preview.level", { level: preview.level.replace("_", " ") })}{" "}
          <strong style={{ color: preview.contains_payloads ? "#f59e0b" : "#10b981" }}>
            {preview.contains_payloads ? t("preview.contains_payloads") : t("preview.no_payloads")}
          </strong>
        </span>
      </div>

      <div style={{ fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.85rem" }}>
        📍 {displayProvenance}
      </div>

      {displaySanitized.length > 0 && (
        <details
          className="np-export__sanitized"
          style={{
            fontSize: "0.85rem",
            color: "var(--np-subtext, #94a3b8)",
            background: "var(--np-bg, #0b1019)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-md, 6px)",
            padding: "0.75rem 1rem",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            🛡️ {t("preview.sanitization_title")} ({displaySanitized.length})
          </summary>
          <ul style={{ margin: "0.5rem 0 0 1.25rem", padding: 0, fontSize: "0.82rem" }}>
            {displaySanitized.map((rule, idx) => (
              <li key={idx} style={{ marginBottom: "0.25rem" }}>
                {rule}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
