import { useTranslation } from "react-i18next";
import { Button, Notice, Skeleton } from "@netpulse/components";
import { Icon } from "../icons";
import { useExportController } from "../hooks/useExportController";
import { ExportFormatSelector } from "./Export/ExportFormatSelector";
import { PayloadLevelSelector } from "./Export/PayloadLevelSelector";
import { ZeroEgressBadge } from "./Export/ZeroEgressBadge";
import { ExportPreviewCard } from "./Export/ExportPreviewCard";

export function Export() {
  const { t } = useTranslation(["export", "common"]);
  const {
    format,
    setFormat,
    level,
    setLevel,
    preview,
    status,
    busy,
    notice,
    setNotice,
    startExport,
    openArtifact,
    artifact,
    opening,
    announcement,
  } = useExportController();

  return (
    <section className="np-export" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="np-export__header">
        <h2 className="np-export__title">{t("title")}</h2>
        <p className="np-export__desc">{t("desc")}</p>
      </header>

      {notice && <Notice message={notice} level={status === "completed" ? "success" : "error"} onDismiss={() => setNotice(null)} />}

      <ZeroEgressBadge />

      <ExportFormatSelector selectedFormat={format} onFormatChange={setFormat} disabled={busy} />

      <PayloadLevelSelector selectedLevel={level} onLevelChange={setLevel} disabled={busy} />

      {status === "loading-preview" && !preview ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={140} width="100%" />
        </div>
      ) : preview ? (
        <ExportPreviewCard preview={preview} />
      ) : null}

      {artifact && (
        <div className="np-export__artifact" role="group" aria-label="Written export file">
          <p className="np-export__artifact-path" title={artifact.path}>
            <strong>{artifact.format.toUpperCase()}</strong> · <code>{artifact.path}</code>
          </p>
          <Button
            variant="secondary"
            disabled={opening}
            busy={opening}
            onClick={() => void openArtifact()}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            {opening ? t("opening", "Opening…") : t("open_file", "Open File")}
          </Button>
        </div>
      )}

      <div className="np-export__actions">
        <Button
          variant="primary"
          disabled={busy}
          busy={busy}
          onClick={() => void startExport()}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          <Icon name="download" style={{ width: "15px", height: "15px" }} />
          {busy ? t("exporting") : t("start_export")}
        </Button>
      </div>
    </section>
  );

}
