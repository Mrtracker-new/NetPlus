import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TracerouteHop, TracerouteResult } from "@netpulse/contract";
import { formatMs } from "../../hooks/useDiagnosticsController";

export interface TracerouteCardProps {
  target?: string;
  hops?: TracerouteHop[];
  result?: TracerouteResult;
  initialView?: "timeline" | "table";
}

export function TracerouteCard({ target: propTarget, hops: propHops, result, initialView = "timeline" }: TracerouteCardProps) {
  const { t } = useTranslation(["diagnostics"]);
  const [viewMode, setViewMode] = useState<"timeline" | "table">(initialView);

  const target = result?.target ?? propTarget ?? "";
  const hops = result?.hops ?? propHops ?? [];

  const headingId = "traceroute-card-title";

  return (
    <article className="np-diagnostics__result" aria-labelledby={headingId}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
          {t("traceroute.title", { target, count: hops.length })}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* Segmented View Toggle: Timeline vs Table */}
          <div
            className="np-diagnostics__segmented"
            role="group"
            aria-label={t("traceroute.view_toggle_aria", "Traceroute view format")}
          >
            <button
              type="button"
              className={`np-diagnostics__segmented-btn ${viewMode === "timeline" ? "np-diagnostics__segmented-btn--active" : ""}`}
              aria-pressed={viewMode === "timeline"}
              onClick={() => setViewMode("timeline")}
            >
              {t("traceroute.view_timeline", "Timeline")}
            </button>
            <button
              type="button"
              className={`np-diagnostics__segmented-btn ${viewMode === "table" ? "np-diagnostics__segmented-btn--active" : ""}`}
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              {t("traceroute.view_table", "Table")}
            </button>
          </div>

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

      {viewMode === "timeline" ? (
        /* Level 3 Recessed Vertical Hop Timeline Track */
        <div className="np-diagnostics__timeline-v" role="region" aria-label={t("traceroute.progression_aria", "Hop Progression")}>
          {hops.length === 0 ? (
            <div style={{ color: "var(--np-text-dim)", fontSize: "0.85rem", padding: "1rem 0", textAlign: "center" }}>
              {t("traceroute.no_hops", "No hops recorded")}
            </div>
          ) : (
            hops.map((h, i) => {
              const isTimeout = h.status === "timeout" || h.ip === "*" || (h.rttMs ?? 0) === 0;
              const rtt = h.rttMs ?? 0;
              const nodeColorVar = isTimeout
                ? "var(--np-neutral)"
                : rtt > 100
                ? "var(--np-finding)"
                : rtt >= 30
                ? "var(--np-notable)"
                : "var(--np-good)";

              const primaryLabel = h.hostname || (h.ip && h.ip !== "*" ? h.ip : "* * *");
              const secondaryIp = h.hostname && h.ip && h.ip !== "*" && h.hostname !== h.ip ? h.ip : null;
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
                    {h.ttl ?? i + 1}
                  </span>
                  <div className="np-diagnostics__hop-details">
                    <span
                      style={{
                        color: isTimeout ? "var(--np-text-dim)" : "var(--np-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 500,
                      }}
                    >
                      {primaryLabel}
                    </span>
                    {secondaryIp && (
                      <span className="np-diagnostics__hop-ip">
                        {secondaryIp}
                      </span>
                    )}
                  </div>

                  {/* Per-hop provenance badge if exposed */}
                  {h.source ? (
                    <span
                      className={`np-diagnostics-provenance ${
                        hopSource === "live"
                          ? "np-diagnostics-provenance--live"
                          : hopSource === "simulated"
                          ? "np-diagnostics-provenance--simulated"
                          : hopSource === "derived"
                          ? "np-diagnostics-provenance--derived"
                          : "np-diagnostics-provenance--unavailable"
                      }`.trim()}
                      style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem" }}
                      data-provenance={hopSource}
                    >
                      {h.source}
                    </span>
                  ) : null}

                  <span style={{ color: nodeColorVar, fontWeight: 600, fontFamily: "var(--np-font-mono)" }}>
                    {isTimeout ? "timeout" : `${formatMs(rtt)} ms`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Responsive Level 3 Recessed Breakdown Table */
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
              {hops.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--np-text-dim)", padding: "1rem" }}>
                    {t("traceroute.no_hops", "No hops recorded")}
                  </td>
                </tr>
              ) : (
                hops.map((h, i) => {
                  const rttStr = formatMs(h.rttMs ?? 0);
                  const isTimeout = h.status === "timeout" || h.ip === "*" || (h.rttMs ?? 0) === 0;
                  const hopSource = h.source ? h.source.toLowerCase() : "";
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, fontFamily: "var(--np-font-mono)" }}>{h.ttl ?? i + 1}</td>
                      <td style={{ fontFamily: "var(--np-font-mono)", color: "var(--np-text)" }}>{h.ip}</td>
                      <td style={{ color: h.hostname ? "var(--np-text)" : "var(--np-text-dim)" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          <span>{h.hostname || (isTimeout ? t("timeout_hop") : "—")}</span>
                          {h.source ? (
                            <span
                              className={`np-diagnostics-provenance ${
                                hopSource === "live"
                                  ? "np-diagnostics-provenance--live"
                                  : hopSource === "simulated"
                                  ? "np-diagnostics-provenance--simulated"
                                  : hopSource === "derived"
                                  ? "np-diagnostics-provenance--derived"
                                  : "np-diagnostics-provenance--unavailable"
                              }`.trim()}
                              style={{ fontSize: "0.6rem", padding: "0.1rem 0.35rem" }}
                              data-provenance={hopSource}
                            >
                              {h.source}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ textAlign: "right", color: isTimeout ? "var(--np-neutral)" : "var(--np-accent-strong)", fontFamily: "var(--np-font-mono)", fontWeight: 600 }}>
                        {isTimeout ? "timeout" : `${rttStr} ms`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
