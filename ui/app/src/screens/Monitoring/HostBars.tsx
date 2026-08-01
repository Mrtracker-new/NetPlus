import { useTranslation } from "react-i18next";
import type { Breakdown } from "@netpulse/contract";
import { BarRow, humanBytes, primaryHostName } from "@netpulse/viz";

export interface HostBarsProps {
  breakdown: Breakdown;
}

export function HostBars({ breakdown }: HostBarsProps) {
  const { t } = useTranslation(["monitoring"]);
  const rows = [...breakdown.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6);
  const max = rows.reduce((m, r) => Math.max(m, r.bytes), 0);

  if (rows.length === 0) return null;

  return (
    <section className="np-panel">
      <h3 className="np-panel__title">{t("top_dimension", { dimension: breakdown.dimension })}</h3>
      {rows.map((r) => {
        const nm = primaryHostName(r);
        return (
          <BarRow
            key={r.label}
            label={nm ? `${nm.name} (${r.label})` : r.label}
            value={r.bytes}
            max={max}
            suffix={humanBytes(r.bytes)}
          />
        );
      })}
    </section>
  );
}
