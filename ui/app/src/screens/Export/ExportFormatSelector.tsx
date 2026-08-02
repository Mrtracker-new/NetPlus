import { useTranslation } from "react-i18next";
import type { ExportFormat } from "@netpulse/contract";

export interface ExportFormatSelectorProps {
  selectedFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  disabled: boolean;
}

export function ExportFormatSelector({
  selectedFormat,
  onFormatChange,
  disabled,
}: ExportFormatSelectorProps) {
  const { t } = useTranslation(["export"]);

  const formats: Array<{ id: ExportFormat; title: string; blurb: string }> = [
    { id: "pcapng", title: t("formats.pcapng"), blurb: t("formats.pcapng_blurb") },
    { id: "json", title: t("formats.json"), blurb: t("formats.json_blurb") },
    { id: "csv", title: t("formats.csv"), blurb: t("formats.csv_blurb") },
    { id: "report", title: t("formats.report"), blurb: t("formats.report_blurb") },
  ];

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--np-subtext, #94a3b8)", marginBottom: "0.5rem" }}>
        {t("format_label")}
      </label>
      <div
        className="np-export__formats"
        role="radiogroup"
        aria-label={t("format_label")}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {formats.map((f) => {
          const isSelected = f.id === selectedFormat;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              className={`np-btn ${isSelected ? "np-btn--primary" : "np-btn--ghost"}`}
              onClick={() => onFormatChange(f.id)}
              style={{
                textAlign: "left",
                padding: "0.85rem 1rem",
                borderRadius: "var(--np-radius-md, 8px)",
                border: isSelected
                  ? "1px solid var(--np-accent, #2fe0d6)"
                  : "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
                whiteSpace: "normal",
                height: "auto",
                minHeight: "80px",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "0.95rem", whiteSpace: "normal" }}>
                {f.title}
              </span>
              <span
                style={{
                  fontSize: "0.78rem",
                  opacity: 0.85,
                  fontWeight: 400,
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: "1.35",
                }}
              >
                {f.blurb}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
