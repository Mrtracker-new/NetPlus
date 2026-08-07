import { useTranslation } from "react-i18next";
import { Button, Input } from "@netpulse/components";
import { parseSessionId } from "../../hooks/useCompareController";

export interface CompareControlsProps {
  sessionA: number;
  sessionB: number;
  onSessionAChange: (val: number) => void;
  onSessionBChange: (val: number) => void;
  onSwap: () => void;
  onCompare: () => void;
  isComparing: boolean;
}

export function CompareControls({
  sessionA,
  sessionB,
  onSessionAChange,
  onSessionBChange,
  onSwap,
  onCompare,
  isComparing,
}: CompareControlsProps) {
  const { t } = useTranslation(["compare"]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCompare();
  };

  return (
    <form className="np-session-diff__controls" onSubmit={handleSubmit} noValidate style={{ marginBottom: "1.5rem" }}>
      <fieldset
        className="np-session-diff__fieldset"
        disabled={isComparing}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          border: "none",
          padding: 0,
          margin: 0,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 200px" }}>
          <Input
            type="number"
            min={1}
            value={sessionA}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSessionAChange(parseSessionId(e.target.value))}
            placeholder={t("select_baseline")}
            aria-label={t("select_baseline")}
          />
        </div>

        <button
          type="button"
          className="np-btn np-btn--ghost"
          style={{ fontSize: "1rem", padding: "0.4rem 0.8rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
          onClick={onSwap}
          title={t("swap_btn")}
        >
          ⇄ {t("swap_btn")}
        </button>

        <div style={{ flex: "1 1 200px" }}>
          <Input
            type="number"
            min={1}
            value={sessionB}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSessionBChange(parseSessionId(e.target.value))}
            placeholder={t("select_target")}
            aria-label={t("select_target")}
          />
        </div>

        <Button type="submit" variant="primary" busy={isComparing} disabled={isComparing}>
          {t("run_diff")}
        </Button>
      </fieldset>
    </form>
  );
}
