import { useState } from "react";
import { Sparkline } from "@netpulse/viz";
import { Icon } from "../../icons";
import type { ProcessMetricRow } from "./monitoringTypes";

export interface ProcessAttributesCardProps {
  processes: ProcessMetricRow[];
}

export function ProcessAttributesCard({ processes = [] }: ProcessAttributesCardProps) {
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"bandwidth" | "cpu" | "memory" | "utilization" | "name">("bandwidth");

  // Sort processes dynamically based on user selection
  const sortedProcesses = [...processes].sort((a, b) => {
    switch (sortBy) {
      case "bandwidth":
        return b.bandwidthBytes - a.bandwidthBytes;
      case "cpu":
        return (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      case "memory":
        return (b.memoryMB ?? -1) - (a.memoryMB ?? -1);
      case "utilization":
        return b.utilizationPercent - a.utilizationPercent;
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  const pageSize = 4;
  const maxPage = Math.max(0, Math.ceil(sortedProcesses.length / pageSize) - 1);
  const currentPage = Math.min(page, maxPage);
  const visibleProcesses = sortedProcesses.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  return (
    <div className="np-monitor-card" aria-label="Process Attributes & Resource Usage">
      <div className="np-monitor-card__header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h3 className="np-monitor-card__title">Process Attributes</h3>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            disabled={processes.length === 0}
            className="np-monitor-select"
            aria-label="Sort process attributes"
          >
            <option value="bandwidth">Sort: Bandwidth</option>
            <option value="cpu">Sort: CPU</option>
            <option value="memory">Sort: Memory</option>
            <option value="utilization">Sort: Utilization</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {/* Working Pagination Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)" }}>
            Page {currentPage + 1} of {maxPage + 1}
          </span>
          <button
            type="button"
            className="np-monitor-icon-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            aria-label="Previous process page"
          >
            ‹
          </button>
          <button
            type="button"
            className="np-monitor-icon-btn"
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={currentPage >= maxPage}
            aria-label="Next process page"
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
          <span>No attributed process flows active in current time window.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginTop: "0.5rem" }}>
          {visibleProcesses.map((p) => {
            const cpuStr = p.cpuPercent != null ? `${p.cpuPercent.toFixed(1)}%` : "—";
            const memStr = p.memoryMB != null ? `${p.memoryMB} MB` : "—";
            const pidStr = p.pid != null ? `PID ${p.pid}` : "Unattributed";

            return (
              <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.825rem", fontWeight: 500 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: p.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "var(--np-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.exePath || p.name}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--np-text-mute)", fontFamily: "var(--np-font-mono)", background: "var(--np-surface-recessed)", padding: "1px 5px", borderRadius: "3px" }}>
                      {pidStr}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontFamily: "var(--np-font-mono)", fontSize: "0.75rem", flexShrink: 0 }}>
                    <span style={{ color: "var(--np-text-mute)" }}>CPU: <strong style={{ color: "var(--np-text-dim)" }}>{cpuStr}</strong></span>
                    <span style={{ color: "var(--np-text-mute)" }}>RAM: <strong style={{ color: "var(--np-text-dim)" }}>{memStr}</strong></span>
                    {p.history && p.history.length > 1 && (
                      <Sparkline values={p.history} data={p.history} color={p.color} width={40} height={12} />
                    )}
                    <span style={{ color: "var(--np-text-dim)", fontWeight: 600 }}>{p.formattedBandwidth}</span>
                    <span style={{ color: "var(--np-text)", fontWeight: 700, minWidth: "36px", textAlign: "right" }}>
                      {p.utilizationPercent}%
                    </span>
                  </div>
                </div>

                {/* Recessed Progress Meter Track */}
                <div className="np-process-track">
                  <div
                    className="np-process-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, p.utilizationPercent))}%`,
                      backgroundColor: p.color,
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

