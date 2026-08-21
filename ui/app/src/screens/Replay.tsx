import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Notice, Skeleton, EmptyState } from "@netpulse/components";
import { Icon } from "../icons";
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
      const targetTag = (e.target as HTMLElement)?.tagName || "";
      if (["INPUT", "BUTTON", "SELECT", "TEXTAREA", "A"].includes(targetTag)) return;

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

      <header className="np-replay__header">
        <div className="np-replay__title-group">
          <h2 className="np-replay__title">{t("title")}</h2>
          <p className="np-replay__desc">{t("desc")}</p>
        </div>

        {/* Playback Status Badge */}
        <Badge
          role="status"
          variant="posture"
          className={`np-replay__status np-replay__status--${status}`}
        >
          {status === "playing"
            ? t("status.playing")
            : status === "completed"
            ? t("status.completed")
            : status === "paused"
            ? t("status.paused")
            : t("status.idle")}
        </Badge>
      </header>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {!loaded ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} aria-busy="true">
          <Skeleton height={120} width="100%" />
          <Skeleton height={100} width="100%" />
          <Skeleton height={140} width="100%" />
        </div>
      ) : !viewModel.hasRecording ? (
        <EmptyState
          icon={<Icon name="replay" />}
          title={t("empty.title")}
          description={t("empty.subtitle")}
        />
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

