import { useTranslation } from "react-i18next";
import { Badge, Button, Notice, Skeleton } from "@netpulse/components";
import { useRecordingsController } from "../hooks/useRecordingsController";
import { RecordingsSummaryKpis } from "./Recordings/RecordingsSummaryKpis";
import { RecordingsFilters } from "./Recordings/RecordingsFilters";
import { RecordingCard } from "./Recordings/RecordingCard";

export function Recordings() {
  const { t } = useTranslation(["recordings", "common"]);
  const {
    filteredRecordings,
    summary,
    isRecording,
    loaded,
    busy,
    notice,
    setNotice,
    privacyFilter,
    setPrivacyFilter,
    startRecording,
    stopRecording,
    announcement,
  } = useRecordingsController();

  const isStubNotice =
    notice && (notice.toLowerCase().includes("live capture") || notice.toLowerCase().includes("stub"));

  return (
    <section className="np-recordings" aria-label={t("title")}>
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="np-recordings__header">
        <div className="np-recordings__title-group">
          <h2 className="np-recordings__title">{t("title")}</h2>
          <p className="np-recordings__desc">{t("desc")}</p>
        </div>

        {/* Live Recording Status Indicator */}
        <Badge
          role="status"
          variant="posture"
          className={
            isRecording
              ? "np-recordings__status np-recordings__status--active"
              : "np-recordings__status np-recordings__status--idle"
          }
        >
          {isRecording ? t("status.active") : t("status.idle")}
        </Badge>
      </header>

      {notice && (
        <Notice
          message={isStubNotice ? t("stub_notice") : notice}
          level={isStubNotice ? "warning" : "error"}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Start / Stop Recording Control Toolbar */}
      <div className="np-recordings__controls">
        <Button
          variant="primary"
          disabled={busy || isRecording}
          busy={busy && isRecording}
          onClick={() => void startRecording()}
        >
          ▶️ {t("common:actions.start_capture")}
        </Button>

        <Button
          variant="standard"
          disabled={busy || !isRecording}
          busy={busy && !isRecording}
          onClick={() => void stopRecording()}
        >
          ⏹️ {t("common:actions.stop_capture")}
        </Button>
      </div>

      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
          <Skeleton height={140} width="100%" />
        </div>
      ) : summary.total === 0 ? (
        <div className="np-recordings__empty">
          <h3 className="np-recordings__empty-title">
            📹 {t("empty.title")}
          </h3>
          <p className="np-recordings__empty-desc">
            {t("empty.subtitle")}
          </p>
          <Button variant="primary" disabled={busy} onClick={() => void startRecording()}>
            ▶️ {t("common:actions.start_capture")}
          </Button>
        </div>
      ) : (
        <>
          {/* Summary KPI Scorecards */}
          <RecordingsSummaryKpis
            total={summary.total}
            totalFrames={summary.totalFrames}
            safeToShareCount={summary.safeToShareCount}
            payloadCount={summary.payloadCount}
          />

          {/* Privacy Level Filters */}
          <RecordingsFilters filter={privacyFilter} onFilterChange={setPrivacyFilter} />

          {/* Recording Cards */}
          {filteredRecordings.map((r) => (
            <RecordingCard key={r.id} rec={r} />
          ))}
        </>
      )}
    </section>
  );
}

