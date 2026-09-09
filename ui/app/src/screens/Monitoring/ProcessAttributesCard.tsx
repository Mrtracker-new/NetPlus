import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkline } from "@netpulse/viz";
import { Icon } from "../../icons";
import type { ProcessMetricRow } from "./monitoringTypes";

export interface ProcessAttributesCardProps {
  processes: ProcessMetricRow[];
}

export function ProcessAttributesCard({ processes = [] }: ProcessAttributesCardProps) {
  const { t } = useTranslation(["monitoring"]);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"bandwidth" | "cpu" | "memory" | "utilization" | "name">("bandwidth");

  // Sort processes dynamically based on user selection with a deterministic tie-breaker
  const sortedProcesses = [...processes].sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case "bandwidth":
        diff = (b.bandwidthBytes || 0) - (a.bandwidthBytes || 0);
        break;
      case "cpu":
        diff = (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
        break;
      case "memory":
        diff = (b.memoryMB ?? -1) - (a.memoryMB ?? -1);
        break;
      case "utilization":
        diff = (b.utilizationPercent || 0) - (a.utilizationPercent || 0);
        break;
      case "name":
        diff = (a.name || "").localeCompare(b.name || "");
        break;
      default:
        diff = 0;
    }
    if (diff !== 0) return diff;
    return (a.id || "").localeCompare(b.id || "");
  });

  const pageSize = 4;
  const maxPage = Math.max(0, Math.ceil(sortedProcesses.length / pageSize) - 1);
  const currentPage = Math.min(page, maxPage);
  const visibleProcesses = sortedProcesses.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  return (
    <div className="np-monitor-card" aria-label={t("process_attributes.aria_label", "Process Attributes & Resource Usage")}>
      <div className="np-monitor-card__header" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h3 className="np-monitor-card__title">{t("process_attributes.title", "Process Attributes")}</h3>
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as any);
              setPage(0);
            }}
            disabled={processes.length === 0}
            className="np-monitor-select"
            aria-label={t("process_attributes.sort_aria_label", "Sort process attributes")}
          >
            <option value="bandwidth">{t("process_attributes.sort_bandwidth", "Sort: Bandwidth")}</option>
            <option value="cpu">{t("process_attributes.sort_cpu", "Sort: CPU")}</option>
            <option value="memory">{t("process_attributes.sort_memory", "Sort: Memory")}</option>
            <option value="utilization">{t("process_attributes.sort_utilization", "Sort: Utilization")}</option>
            <option value="name">{t("process_attributes.sort_name", "Sort: Name")}</option>
          </select>
        </div>

        {/* Working Pagination Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
            {t("process_attributes.pagination", {
              current: currentPage + 1,
              total: maxPage + 1,
              defaultValue: `Page ${currentPage + 1} of ${maxPage + 1}`,
            })}
          </span>
          <button
            type="button"
            className="np-monitor-icon-btn"
            onClick={() => setPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            aria-label={t("process_attributes.prev_page", "Previous process page")}
          >
            ‹
          </button>
          <button
            type="button"
            className="np-monitor-icon-btn"
            onClick={() => setPage(Math.min(maxPage, currentPage + 1))}
            disabled={currentPage >= maxPage}
            aria-label={t("process_attributes.next_page", "Next process page")}
          >
            ›
          </button>
        </div>
      </div>

      {/* Process Rows List / Empty State */}
      {visibleProcesses.length === 0 ? (
        <div
          style={{
            height: 180,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            color: "var(--np-text-mute)",
            fontSize: "0.85rem",
            textAlign: "center",
            padding: "1rem",
          }}
        >
          <Icon name="zap" style={{ width: "24px", height: "24px", color: "var(--np-accent)" }} />
          <span>{t("process_attributes.empty", "No attributed process flows active in current time window.")}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginTop: "0.5rem" }}>
          {visibleProcesses.map((p) => {
            const cpuStr = typeof p.cpuPercent === "number" && !isNaN(p.cpuPercent) ? `${p.cpuPercent.toFixed(1)}%` : "—";
            const memStr = typeof p.memoryMB === "number" && !isNaN(p.memoryMB) ? `${p.memoryMB} MB` : "—";
            const pidStr = typeof p.pid === "number" && !isNaN(p.pid) ? `PID ${p.pid}` : t("process_attributes.unattributed", "Unattributed");
            const pktsStr =
              typeof p.packets === "number" && !isNaN(p.packets)
                ? p.packets.toLocaleString()
                : "—";
            const flowsStr =
              typeof p.flows === "number" && !isNaN(p.flows)
                ? p.flows.toLocaleString()
                : "—";
            const safeUtil =
              typeof p.utilizationPercent === "number" && !isNaN(p.utilizationPercent)
                ? Math.min(100, Math.max(0, p.utilizationPercent))
                : 0;
            const displayName = p.name || t("process_attributes.unknown_process", "Unknown Process");
            const validHistory = p.history?.filter((v) => typeof v === "number" && !isNaN(v));

            return (
              <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.4rem 0.6rem", fontSize: "0.825rem", fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flexShrink: 1 }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: p.color || "var(--np-accent, #2fe0d6)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        color: "var(--np-text)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                        maxWidth: "min(200px, 100%)",
                      }}
                      title={p.exePath || displayName}
                    >
                      {displayName}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)", background: "var(--np-surface-recessed)", padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>
                      {pidStr}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem 0.6rem", flexWrap: "wrap", fontFamily: "var(--np-font-mono)", fontSize: "0.75rem", minWidth: 0 }}>
                    <span style={{ color: "var(--np-text-mute)", whiteSpace: "nowrap" }}>{t("process_attributes.cpu_label", "CPU:")} <strong style={{ color: "var(--np-text-dim)" }}>{cpuStr}</strong></span>
                    <span style={{ color: "var(--np-text-mute)", whiteSpace: "nowrap" }}>{t("process_attributes.ram_label", "RAM:")} <strong style={{ color: "var(--np-text-dim)" }}>{memStr}</strong></span>
                    <span style={{ color: "var(--np-text-mute)", whiteSpace: "nowrap" }}>{t("process_attributes.packets_label", "Pkts:")} <strong style={{ color: "var(--np-text-dim)" }}>{pktsStr}</strong></span>
                    <span style={{ color: "var(--np-text-mute)", whiteSpace: "nowrap" }}>{t("process_attributes.flows_label", "Flows:")} <strong style={{ color: "var(--np-text-dim)" }}>{flowsStr}</strong></span>
                    {validHistory && validHistory.length > 1 && (
                      <span style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
                        <Sparkline values={validHistory} data={validHistory} color={p.color || "var(--np-accent)"} width={40} height={12} />
                      </span>
                    )}
                    <span style={{ color: "var(--np-text-dim)", fontWeight: 600, whiteSpace: "nowrap" }}>{p.formattedBandwidth || "0 B"}</span>
                    <span style={{ color: "var(--np-text)", fontWeight: 700, minWidth: "36px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {safeUtil}%
                    </span>
                  </div>
                </div>

                {/* Recessed Progress Meter Track */}
                <div className="np-process-track">
                  <div
                    className="np-process-fill"
                    role="progressbar"
                    aria-label={t("process_attributes.utilization_aria_label", {
                      name: displayName,
                      defaultValue: `${displayName} utilization`,
                    })}
                    aria-valuenow={safeUtil}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={`${safeUtil}%`}
                    style={{
                      width: `${safeUtil}%`,
                      backgroundColor: p.color || "var(--np-accent, #2fe0d6)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

