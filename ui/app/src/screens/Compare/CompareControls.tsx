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
      >
        <div style={{ flex: "1 1 200px" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--np-subtext)", marginBottom: "0.35rem" }}>
            {t("select_baseline")}
          </label>
          <Input
            type="number"
            min={1}
            value={sessionA}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSessionAChange(parseSessionId(e.target.value))}
            placeholder={t("select_baseline")}
            aria-label={t("select_baseline")}
          />
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", height: "100%", paddingTop: "1.35rem" }}>
          <Button
            variant="standard"
            onClick={onSwap}
            title={t("swap_btn")}
          >
            ⇄ {t("swap_btn")}
          </Button>
        </div>

        <div style={{ flex: "1 1 200px" }}>
          <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--np-subtext)", marginBottom: "0.35rem" }}>
            {t("select_target")}
          </label>
          <Input
            type="number"
            min={1}
            value={sessionB}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSessionBChange(parseSessionId(e.target.value))}
            placeholder={t("select_target")}
            aria-label={t("select_target")}
          />
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", height: "100%", paddingTop: "1.35rem" }}>
          <Button type="submit" variant="primary" busy={isComparing} disabled={isComparing}>
            {t("run_diff")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
