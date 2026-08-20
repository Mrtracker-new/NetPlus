import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";

export interface LearnSummaryKpisProps {
  total: number;
  completedCount: number;
  masteredCount: number;
  overallMasteryPct: number;
  groundedPct: number;
  onResetProgress?: () => void;
}

export function LearnSummaryKpis({
  total,
  completedCount,
  masteredCount,
  overallMasteryPct,
  groundedPct,
  onResetProgress,
}: LearnSummaryKpisProps) {
  const { t } = useTranslation(["learn", "common"]);

  const items = [
    { label: t("kpis.total", { defaultValue: "Total Lessons" }), value: total, color: "var(--np-text)" },
    { label: t("kpis.completed", { defaultValue: "Completed" }), value: `${completedCount} (${masteredCount} Mastered)`, color: "var(--np-good)" },
    { label: t("kpis.mastery", { defaultValue: "Curriculum Mastery" }), value: `${overallMasteryPct}%`, color: "var(--np-accent-strong)" },
    { label: t("kpis.grounded_pct", { defaultValue: "Grounded" }), value: `${groundedPct}%`, color: "var(--np-accent-2)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div className="np-kpis">
        {items.map((item) => (
          <div key={item.label} className="np-kpi">
            <div className="np-kpi__label">{item.label}</div>
            <div className="np-kpi__value" style={{ color: item.color }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
      {onResetProgress && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="standard"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--np-text-mute)" }}
            onClick={onResetProgress}
          >
            ↺ {t("actions.reset_progress", { defaultValue: "Reset Training Progress" })}
          </Button>
        </div>
      )}
    </div>
  );
}


