import { useTranslation } from "react-i18next";
import { Badge } from "@netpulse/components";
import type { ExtendedFleetHost, FleetStatus } from "../../hooks/useFleetController";
import { useDisclosure } from "../../modes/DisclosureContext";

export interface FleetNodeCardProps {
  host: ExtendedFleetHost;
}

const STATUS_COLORS: Record<FleetStatus, string> = {
  online: "#10b981",
  degraded: "#f59e0b",
  offline: "#ef4444",
  unknown: "#6b7280",
};

export function FleetNodeCard({ host }: FleetNodeCardProps) {
  const { t } = useTranslation(["fleet"]);
  const { shows } = useDisclosure();

  const statusColor = STATUS_COLORS[host.normalizedStatus] ?? "#6b7280";
  const localizedStatus = t(`status.${host.normalizedStatus}` as any, { defaultValue: host.status });

  // Mask Agent ID unless intermediate/expert disclosure mode is enabled
  const maskedId = host.hostId && host.hostId.length > 6
    ? `••••••${host.hostId.slice(-6)}`
    : host.hostId;

  return (
    <article
      className="np-fleet__node"
      role="listitem"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: `1px solid ${statusColor}33`,
        borderLeft: `4px solid ${statusColor}`,
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.1rem 1.25rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
          <strong className="np-fleet__name" style={{ fontSize: "1.05rem", color: "var(--np-text, #e2e8f0)" }}>
            {host.friendlyName || host.hostname}
          </strong>
          <span style={{ fontSize: "0.8rem", color: "var(--np-muted, #8b9bb4)" }}>
            ({host.os} / {host.platform})
          </span>
        </div>

        <p className="np-fleet__meta" style={{ margin: 0, fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)" }}>
          {t("card.version")}: <span style={{ fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>{host.agentVersion}</span>
          {" · "}
          {t("card.agent_id")}:{" "}
          <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--np-accent, #2fe0d6)" }}>
            {shows("intermediate") ? host.hostId : maskedId}
          </span>
        </p>
      </div>

      <div>
        <Badge
          variant="kind"
          aria-label={`Status: ${localizedStatus}`}
          style={{
            background: statusColor,
            color: "#000",
            fontWeight: 700,
            fontSize: "0.8rem",
            padding: "0.25rem 0.65rem",
          }}
        >
          {localizedStatus}
        </Badge>
      </div>
    </article>
  );
}
