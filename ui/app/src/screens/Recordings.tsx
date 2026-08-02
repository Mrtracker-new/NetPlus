import { useTranslation } from "react-i18next";
import { Button, Notice, Skeleton } from "@netpulse/components";
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: "0 0 0.4rem 0", color: "var(--np-text, #e2e8f0)" }}>
            {t("title")}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--np-subtext, #94a3b8)", margin: 0 }}>
            {t("desc")}
          </p>
        </div>

        {/* Live Recording Status Indicator */}
        <span
          role="status"
          style={{
            fontSize: "0.85rem",
            padding: "0.4rem 0.85rem",
            borderRadius: "16px",
            background: isRecording ? "rgba(239, 68, 68, 0.2)" : "rgba(148, 163, 184, 0.2)",
            color: isRecording ? "#ef4444" : "#94a3b8",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          {isRecording ? t("status.active") : t("status.idle")}
        </span>
      </div>

      {notice && (
        <Notice
          message={isStubNotice ? t("stub_notice") : notice}
          level={isStubNotice ? "warning" : "error"}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Start / Stop Recording Control Toolbar */}
      <div
        className="np-recordings__controls"
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          marginBottom: "1.5rem",
          background: "var(--np-surface-1, #131b2a)",
          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
          borderRadius: "var(--np-radius-lg, 12px)",
          padding: "1rem 1.25rem",
        }}
      >
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
          style={{ border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
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
        <div
          style={{
            background: "var(--np-surface-1, #131b2a)",
            border: "1px dashed var(--np-surface-2, rgba(255, 255, 255, 0.15))",
            borderRadius: "var(--np-radius-lg, 12px)",
            padding: "2.5rem 1.5rem",
            textAlign: "center",
            color: "var(--np-subtext, #94a3b8)",
          }}
        >
          <h3 style={{ fontSize: "1.15rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)", margin: "0 0 0.5rem 0" }}>
            📹 {t("empty.title")}
          </h3>
          <p style={{ fontSize: "0.9rem", margin: "0 0 1.25rem 0", maxWidth: "550px", marginLeft: "auto", marginRight: "auto", lineHeight: "1.6" }}>
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
