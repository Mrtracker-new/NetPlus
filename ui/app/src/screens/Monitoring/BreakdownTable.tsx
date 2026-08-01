import { useTranslation } from "react-i18next";
import type { Breakdown } from "@netpulse/contract";
import { humanBytes, primaryHostName } from "@netpulse/viz";

export interface BreakdownTableProps {
  breakdown: Breakdown;
}

export function BreakdownTable({ breakdown }: BreakdownTableProps) {
  const { t } = useTranslation(["monitoring"]);
  const rows = [...breakdown.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6);

  if (rows.length === 0) return null;

  return (
    <section className="np-panel">
      <table className="np-breakdown" aria-label={t("top_breakdown", { dimension: breakdown.dimension })}>
        <caption>{t("top_breakdown", { dimension: breakdown.dimension })}</caption>
        <tbody>
          {rows.map((r) => {
            const nm = primaryHostName(r);
            return (
              <tr key={r.label}>
                <td>{nm ? nm.name : r.label}</td>
                <td>{nm ? r.label : `${r.flows} flow${r.flows === 1 ? "" : "s"}`}</td>
                <td style={{ textAlign: "right" }}>{humanBytes(r.bytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
