import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";

export interface ReplayTransportProps {
  playing: boolean;
  canPlay: boolean;
  canPause: boolean;
  canStep: boolean;
  busy: boolean;
  activeSpeedPercent: number;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onSetSpeed: (percent: number) => void;
}

export function ReplayTransport({
  playing,
  canPlay,
  canPause,
  canStep,
  busy,
  activeSpeedPercent,
  onPlay,
  onPause,
  onStep,
  onSetSpeed,
}: ReplayTransportProps) {
  const { t } = useTranslation(["replay"]);

  const speeds = [
    { percent: 10, label: t("speeds.teach") },
    { percent: 50, label: t("speeds.half") },
    { percent: 100, label: t("speeds.normal") },
    { percent: 200, label: t("speeds.fast") },
    { percent: 1000, label: t("speeds.skim") },
  ];

  return (
    <div
      className="np-replay__transport"
      role="group"
      aria-label="Transport Controls"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        marginBottom: "1.25rem",
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1rem 1.25rem",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {playing ? (
          <Button variant="primary" disabled={busy || !canPause} onClick={onPause}>
            ⏸️ {t("controls.pause")}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !canPlay} onClick={onPlay}>
            ▶️ {t("controls.play")}
          </Button>
        )}

        <Button variant="standard" disabled={busy || !canStep} onClick={onStep} style={{ border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}>
          ⏭️ {t("controls.step")}
        </Button>
      </div>

      <div className="np-replay__speeds" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {speeds.map((s) => {
          const isActive = activeSpeedPercent === s.percent;
          return (
            <button
              key={s.percent}
              type="button"
              disabled={busy}
              className={`np-btn ${isActive ? "np-btn--primary" : "np-btn--ghost"}`}
              style={{ fontSize: "0.82rem", padding: "0.3rem 0.65rem" }}
              onClick={() => onSetSpeed(s.percent)}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
