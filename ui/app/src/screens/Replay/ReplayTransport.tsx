import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
import { Icon } from "../../icons";

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
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <Icon name="pause" style={{ width: "13px", height: "13px" }} />
              <span>{t("controls.pause")}</span>
            </span>
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !canPlay} onClick={onPlay}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <Icon name="play" style={{ width: "13px", height: "13px" }} />
              <span>{t("controls.play")}</span>
            </span>
          </Button>
        )}

        <Button variant="standard" disabled={busy || !canStep} onClick={onStep}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <Icon name="stepForward" style={{ width: "13px", height: "13px" }} />
            <span>{t("controls.step")}</span>
          </span>
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

