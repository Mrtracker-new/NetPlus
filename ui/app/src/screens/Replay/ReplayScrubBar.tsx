import { useTranslation } from "react-i18next";
import type { ReplayState } from "@netpulse/contract";

export interface ReplayScrubBarProps {
  state: ReplayState | null;
  hasRecording: boolean;
  disabled: boolean;
  formattedPosition: string;
  formattedTotal: string;
  progressPct: number;
  onSeek: (monoNanos: number) => void;
}

export function ReplayScrubBar({
  state,
  hasRecording,
  disabled,
  formattedPosition,
  formattedTotal,
  progressPct,
  onSeek,
}: ReplayScrubBarProps) {
  const { t } = useTranslation(["replay"]);

  const totalNanos = state?.total_nanos ?? 0;
  const currentNanos = state?.position_nanos ?? 0;

  return (
    <div className="np-replay__scrub">
      <div className="np-replay__scrub-meta">
        <span>⏱️ {formattedPosition}</span>
        <span className="np-replay__scrub-progress">{progressPct}%</span>
        <span>⏱️ {formattedTotal}</span>
      </div>

      <input
        className="np-replay__seek"
        type="range"
        min={0}
        max={totalNanos}
        value={currentNanos}
        aria-label="Seek replay position"
        aria-valuetext={`${formattedPosition} of ${formattedTotal}`}
        disabled={disabled || !hasRecording}
        onChange={(e) => onSeek(Number(e.target.value))}
      />

      <div className="np-replay__readout">
        <span>{t("card.frame_index", { index: state?.frame_index ?? 0 })}</span>
        {state?.incomplete && (
          <span className="np-replay__incomplete">
            ⚠️ {t("card.incomplete")}
          </span>
        )}
      </div>
    </div>
  );
}

