import { useTranslation } from "react-i18next";
import { Badge } from "@netpulse/components";
import type { ExtendedFleetHost, FleetStatus } from "../../hooks/useFleetController";
import { useDisclosure } from "../../modes/DisclosureContext";

export interface FleetNodeCardProps {
  host: ExtendedFleetHost;
}

const STATUS_COLORS: Record<FleetStatus, string> = {
  online: "var(--np-good)",
  degraded: "var(--np-notable)",
  offline: "var(--np-finding)",
  unknown: "var(--np-subtext)",
};

export function FleetNodeCard({ host }: FleetNodeCardProps) {
  const { t } = useTranslation(["fleet"]);
  const { shows } = useDisclosure();

  const statusColor = STATUS_COLORS[host.normalizedStatus] ?? "var(--np-subtext)";
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
        borderLeft: `4px solid ${statusColor}`,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
          <strong className="np-fleet__name" style={{ fontSize: "1.05rem", color: "var(--np-text)" }}>
            {host.friendlyName || host.hostname}
          </strong>
          <span style={{ fontSize: "0.8rem", color: "var(--np-subtext)" }}>
            ({host.os} / {host.platform})
          </span>
        </div>

        <p className="np-fleet__meta" style={{ margin: 0, fontSize: "0.85rem", color: "var(--np-subtext)" }}>
          {t("card.version")}: <span style={{ fontWeight: 600, color: "var(--np-text)" }}>{host.agentVersion}</span>
          {" · "}
          {t("card.agent_id")}:{" "}
          <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--np-accent)" }}>
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
            color: "var(--np-bg)",
            fontWeight: 700,
            fontSize: "0.8rem",
            padding: "0.3rem 0.75rem",
            boxShadow: "var(--np-neu-sm)",
          }}
        >
          {localizedStatus}
        </Badge>
      </div>
    </article>
  );
}
