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
    <div
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.5rem" }}>
        <span>⏱️ {formattedPosition}</span>
        <span style={{ fontWeight: 600, color: "var(--np-accent, #2fe0d6)" }}>{progressPct}%</span>
        <span>⏱️ {formattedTotal}</span>
      </div>

      <input
        className="np-replay__seek"
        type="range"
        min={0}
        max={totalNanos}
        value={currentNanos}
        aria-label="Seek replay position"
        disabled={disabled || !hasRecording}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ width: "100%", cursor: disabled || !hasRecording ? "not-allowed" : "pointer" }}
      />

      <div
        className="np-replay__readout"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", color: "var(--np-subtext, #94a3b8)", marginTop: "0.75rem" }}
      >
        <span>{t("card.frame_index", { index: state?.frame_index ?? 0 })}</span>
        {state?.incomplete && (
          <span className="np-replay__incomplete" style={{ color: "#ef4444", fontWeight: 600 }}>
            ⚠️ {t("card.incomplete")}
          </span>
        )}
      </div>
    </div>
  );
}
