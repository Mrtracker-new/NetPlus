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
    <div>
      <label className="np-export__label">
        {t("format_label")}
      </label>
      <div
        className="np-export__formats"
        role="radiogroup"
        aria-label={t("format_label")}
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
              className="np-export__format-card"
              onClick={() => onFormatChange(f.id)}
            >
              <span className="np-export__format-title">
                {f.title}
              </span>
              <span className="np-export__format-blurb">
                {f.blurb}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

