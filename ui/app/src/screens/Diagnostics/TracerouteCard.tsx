import { useTranslation } from "react-i18next";
import type { TracerouteHop } from "@netpulse/contract";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface TracerouteCardProps {
  target: string;
  hops: TracerouteHop[];
}

export function TracerouteCard({ target, hops }: TracerouteCardProps) {
  const { t } = useTranslation(["diagnostics"]);

  return (
    <div
      className="np-diagnostics__result"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        {t("traceroute.title", { target, count: hops.length })}
      </h3>

      <table className="np-breakdown" aria-label={t("traceroute.title", { target, count: hops.length })}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--np-muted, #8b9bb4)", fontSize: "0.8rem" }}>
            <th scope="col">{t("traceroute.ttl")}</th>
            <th scope="col">{t("traceroute.ip")}</th>
            <th scope="col">{t("traceroute.hostname")}</th>
            <th scope="col" style={{ textAlign: "right" }}>{t("traceroute.rtt")}</th>
          </tr>
        </thead>
        <tbody>
          {hops.map((h, i) => {
            const rttStr = formatMs(h.rttMs ?? 0);
            return (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{h.ttl}</td>
                <td style={{ fontFamily: "monospace" }}>{h.ip}</td>
                <td>{h.hostname || "—"}</td>
                <td style={{ textAlign: "right", color: "var(--np-accent, #2fe0d6)" }}>{rttStr} ms</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
