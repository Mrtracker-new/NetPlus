import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Notice, Skeleton } from "@netpulse/components";
import { useReplayController } from "../hooks/useReplayController";
import { ReplaySummaryKpis } from "./Replay/ReplaySummaryKpis";
import { ReplayTransport } from "./Replay/ReplayTransport";
import { ReplayScrubBar } from "./Replay/ReplayScrubBar";

export function Replay() {
  const { t } = useTranslation(["replay", "common"]);
  const {
    state,
    status,
    viewModel,
    loaded,
    busy,
    notice,
    setNotice,
    play,
    pause,
    step,
    setSpeed,
    seek,
    announcement,
  } = useReplayController();

  // Keyboard Shortcuts (Space = Play/Pause, ArrowLeft = Step Back / Seek, ArrowRight = Step Forward / Seek)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;

      if (e.code === "Space") {
        e.preventDefault();
        if (status === "playing") void pause();
        else if (viewModel.canPlay) void play();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        void step();
      } else if (e.code === "ArrowLeft" && state) {
        e.preventDefault();
        const prevNanos = Math.max(0, state.position_nanos - 1_000_000_000);
        seek(prevNanos);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, viewModel.canPlay, play, pause, step, seek, state]);

  return (
    <section className="np-replay" aria-label={t("title")}>
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

        {/* Playback Status Badge */}
        <span
          role="status"
          style={{
            fontSize: "0.85rem",
            padding: "0.4rem 0.85rem",
            borderRadius: "16px",
            background:
              status === "playing"
                ? "rgba(16, 185, 129, 0.2)"
                : status === "completed"
                ? "rgba(59, 130, 246, 0.2)"
                : "rgba(148, 163, 184, 0.2)",
            color:
              status === "playing"
                ? "#10b981"
                : status === "completed"
                ? "#60a5fa"
                : "#94a3b8",
            fontWeight: 600,
          }}
        >
          {status === "playing"
            ? t("status.playing")
            : status === "completed"
            ? t("status.completed")
            : status === "paused"
            ? t("status.paused")
            : t("status.idle")}
        </span>
      </div>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={120} width="100%" />
          <Skeleton height={100} width="100%" />
          <Skeleton height={140} width="100%" />
        </div>
      ) : !viewModel.hasRecording ? (
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
            📼 {t("empty.title")}
          </h3>
          <p style={{ fontSize: "0.9rem", margin: 0, maxWidth: "550px", marginLeft: "auto", marginRight: "auto", lineHeight: "1.6" }}>
            {t("empty.subtitle")}
          </p>
        </div>
      ) : (
        <>
          {/* Replay Summary KPI Cards */}
          <ReplaySummaryKpis
            frameIndex={viewModel.frameIndex}
            formattedPosition={viewModel.formattedPosition}
            formattedTotal={viewModel.formattedTotal}
            speedLabel={viewModel.speedLabel}
          />

          {/* Transport Toolbar */}
          <ReplayTransport
            playing={status === "playing"}
            canPlay={viewModel.canPlay}
            canPause={viewModel.canPause}
            canStep={viewModel.canStep}
            busy={busy}
            activeSpeedPercent={viewModel.activeSpeedPercent}
            onPlay={() => void play()}
            onPause={() => void pause()}
            onStep={() => void step()}
            onSetSpeed={(pct) => void setSpeed(pct)}
          />

          {/* Scrub Bar Timeline */}
          <ReplayScrubBar
            state={state}
            hasRecording={viewModel.hasRecording}
            disabled={busy}
            formattedPosition={viewModel.formattedPosition}
            formattedTotal={viewModel.formattedTotal}
            progressPct={viewModel.progressPct}
            onSeek={seek}
          />
        </>
      )}
    </section>
  );
}
