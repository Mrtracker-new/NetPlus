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
    <article className="np-diagnostics__result" aria-label={t("traceroute.title", { target, count: hops.length })}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("traceroute.title", { target, count: hops.length })}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              padding: "0.25rem 0.65rem",
              borderRadius: "var(--np-radius-pill)",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "var(--np-surface-2)",
              color: "var(--np-text-dim)",
              boxShadow: "var(--np-neu-inset)",
            }}
          >
            {t("traceroute.hops_count", { count: hops.length })}
          </span>
        </div>
      </div>

      {/* Level 3 Recessed Vertical Hop Timeline Track */}
      <div className="np-diagnostics__timeline-v" role="region" aria-label="Hop Progression">
        {hops.map((h, i) => {
          const isTimeout = h.status === "timeout" || h.ip === "*" || (h.rttMs ?? 0) === 0;
          const rtt = h.rttMs ?? 0;
          const nodeColorVar = isTimeout
            ? "var(--np-neutral)"
            : rtt > 100
            ? "var(--np-finding)"
            : rtt >= 30
            ? "var(--np-notable)"
            : "var(--np-good)";

          const label = h.hostname || h.ip || "* * *";
          const hopSource = h.source ? h.source.toLowerCase() : "";

          return (
            <div key={i} className="np-diagnostics__hop-row-v">
              <div
                className="np-diagnostics__hop-dot"
                style={{
                  background: isTimeout ? "transparent" : nodeColorVar,
                  border: `2px solid ${nodeColorVar}`,
                  color: nodeColorVar,
                }}
              />
              <span style={{ minWidth: "24px", color: "var(--np-text-mute)", fontWeight: 600 }}>
                {h.ttl}
              </span>
              <span
                style={{
                  flex: 1,
                  color: isTimeout ? "var(--np-text-dim)" : "var(--np-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>

              {/* Per-hop provenance badge if exposed */}
              {h.source && (
                <span
                  className={`np-diagnostics-provenance ${
                    hopSource === "live"
                      ? "np-diagnostics-provenance--live"
                      : hopSource === "simulated"
                      ? "np-diagnostics-provenance--simulated"
                      : hopSource === "derived"
                      ? "np-diagnostics-provenance--derived"
                      : "np-diagnostics-provenance--unavailable"
                  }`}
                  style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem" }}
                  data-provenance={h.source}
                >
                  {h.source}
                </span>
              )}

              <span style={{ color: nodeColorVar, fontWeight: 600, fontFamily: "var(--np-font-mono)" }}>
                {isTimeout ? "timeout" : `${formatMs(rtt)} ms`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Responsive Level 3 Recessed Breakdown Table */}
      <div className="np-diagnostics-table-wrap">
        <table className="np-breakdown" aria-label={t("traceroute.title", { target, count: hops.length })}>
          <thead>
            <tr>
              <th scope="col">{t("traceroute.ttl")}</th>
              <th scope="col">{t("traceroute.ip")}</th>
              <th scope="col">{t("traceroute.hostname")}</th>
              <th scope="col" style={{ textAlign: "right" }}>{t("traceroute.rtt")}</th>
            </tr>
          </thead>
          <tbody>
            {hops.map((h, i) => {
              const rttStr = formatMs(h.rttMs ?? 0);
              const isTimeout = h.status === "timeout" || h.ip === "*" || (h.rttMs ?? 0) === 0;
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontFamily: "var(--np-font-mono)" }}>{h.ttl}</td>
                  <td style={{ fontFamily: "var(--np-font-mono)", color: "var(--np-text)" }}>{h.ip}</td>
                  <td style={{ color: h.hostname ? "var(--np-text)" : "var(--np-text-dim)" }}>
                    {h.hostname || (isTimeout ? t("timeout_hop") : "—")}
                  </td>
                  <td style={{ textAlign: "right", color: isTimeout ? "var(--np-neutral)" : "var(--np-accent-strong)", fontFamily: "var(--np-font-mono)", fontWeight: 600 }}>
                    {isTimeout ? "timeout" : `${rttStr} ms`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
