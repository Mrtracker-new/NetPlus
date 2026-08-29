import { useState } from "react";
import { Sparkline } from "@netpulse/viz";
import { Icon } from "../../icons";
import type { ProcessMetricRow } from "./monitoringTypes";

export interface ProcessAttributesCardProps {
  processes: ProcessMetricRow[];
}

export function ProcessAttributesCard({ processes = [] }: ProcessAttributesCardProps) {
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"bandwidth" | "cpu" | "utilization" | "name">("bandwidth");

  // Sort processes dynamically based on user selection
  const sortedProcesses = [...processes].sort((a, b) => {
    switch (sortBy) {
      case "bandwidth":
        return b.bandwidthBytes - a.bandwidthBytes;
      case "cpu":
        return b.cpuPercent - a.cpuPercent;
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
          <span>Capture Standby — No active process telemetry recorded.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", marginTop: "0.5rem" }}>
          {visibleProcesses.map((p) => (
            <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.825rem", fontWeight: 500 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: p.color,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--np-text)" }}>{p.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontFamily: "var(--np-font-mono)" }}>
                  <Sparkline values={p.history} data={p.history} color={p.color} width={50} height={14} />
                  <span style={{ color: "var(--np-text-dim)" }}>{p.formattedBandwidth}</span>
                  <span style={{ color: "var(--np-text)", fontWeight: 700, minWidth: "40px", textAlign: "right" }}>
                    {p.utilizationPercent}%
                  </span>
                </div>
              </div>

              {/* Recessed Progress Meter Track */}
              <div className="np-process-track">
                <div
                  className="np-process-fill"
                  style={{
                    width: `${Math.min(100, Math.max(4, p.utilizationPercent * 7))}%`,
                    backgroundColor: p.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

