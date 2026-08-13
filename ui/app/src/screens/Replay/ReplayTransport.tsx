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
    <div className="np-replay__transport" role="group" aria-label="Transport Controls">
      <div className="np-replay__actions">
        {playing ? (
          <Button variant="primary" disabled={busy || !canPause} onClick={onPause}>
            ⏸️ {t("controls.pause")}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !canPlay} onClick={onPlay}>
            ▶️ {t("controls.play")}
          </Button>
        )}

        <Button variant="standard" disabled={busy || !canStep} onClick={onStep}>
          ⏭️ {t("controls.step")}
        </Button>
      </div>

      <div className="np-replay__speeds">
        {speeds.map((s) => {
          const isActive = activeSpeedPercent === s.percent;
          return (
            <Button
              key={s.percent}
              type="button"
              disabled={busy}
              className="np-replay__speed"
              aria-pressed={isActive}
              onClick={() => onSetSpeed(s.percent)}
            >
              {s.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

