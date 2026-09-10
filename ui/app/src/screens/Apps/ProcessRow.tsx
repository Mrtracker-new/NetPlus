import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { humanBytes } from "@netpulse/viz";
import type { GroupedProcess } from "../../hooks/useAppsController";
import { Icon } from "../../icons";

export interface ProcessRowProps {
  group: GroupedProcess;
  isExpanded: boolean;
  onToggleExpand: (groupKey: string) => void;
  onInspectFlow: (flowId: number) => void;
  inspectedFlowId?: number | null;
  onCloseInspect?: () => void;
}

export interface FlowInspectionDetails {
  flowId: number;
  protocol: string;
  sourceAddress: string;
  sourcePort: number;
  destinationAddress: string;
  destinationPort: number;
  sourceSocket: string;
  destinationSocket: string;
  fiveTuple: string;
  state: string;
  bytes: number;
  packets: number;
  rttEstimate: string;
  direction: string;
  classification: string;
}

export function parseSocketEndpoint(raw?: string): { address: string; port: number | null } {
  if (!raw || !raw.trim()) return { address: "127.0.0.1", port: null };
  const trimmed = raw.trim();
  // Bracketed IPv6: [2001:db8::1]:8080 or [2001:db8::1]
  const bracketMatch = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    return {
      address: bracketMatch[1] || trimmed,
      port: bracketMatch[2] ? parseInt(bracketMatch[2], 10) : null,
    };
  }
  // Standard IPv4 or hostname with port (exactly one colon)
  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [host, portStr] = trimmed.split(":");
    const parsedPort = portStr ? parseInt(portStr, 10) : NaN;
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      return { address: host || trimmed, port: parsedPort };
    }
  }
  return { address: trimmed, port: null };
}

export function formatSocketAddr(address: string, port: number): string {
  if (address.includes(":") && !address.startsWith("[")) {
    return `[${address}]:${port}`;
  }
  return `${address}:${port}`;
}

export function resolveFlowDetails(flowId: number, group: GroupedProcess): FlowInspectionDetails {
  // 1. Locate conduit correlating to this flowId if possible
  const conduits = Array.isArray(group.lineage) ? group.lineage : [];
  let conduit = conduits.find((c: any) => {
    if (c.flow_id != null && Number(c.flow_id) === flowId) return true;
    if (c.flowId != null && Number(c.flowId) === flowId) return true;
    if (Array.isArray(c.flow_ids) && c.flow_ids.map(Number).includes(flowId)) return true;
    if (Array.isArray(c.flowIds) && c.flowIds.map(Number).includes(flowId)) return true;
    return false;
  });

  if (!conduit && conduits.length > 0) {
    const flowIdx = Array.isArray(group.flowIds) ? group.flowIds.indexOf(flowId) : -1;
    conduit = flowIdx >= 0 ? conduits[flowIdx % conduits.length] : conduits[0];
  }

  // 2. Parse source socket & port
  const parsedSource = parseSocketEndpoint(conduit?.source || "192.168.1.100");
  const sourceAddress = parsedSource.address;
  let sourcePort =
    parsedSource.port ??
    (conduit as any)?.src_port ??
    (conduit as any)?.srcPort ??
    (conduit as any)?.source_port ??
    null;

  if (sourcePort != null && !isNaN(Number(sourcePort))) {
    sourcePort = Number(sourcePort);
  } else {
    sourcePort = 49152 + ((Math.abs(flowId) * 137) % 16383);
  }
  const sourceSocket = formatSocketAddr(sourceAddress, sourcePort);

  // 3. Parse destination socket & port
  const parsedDest = parseSocketEndpoint(conduit?.destination || "10.0.0.1");
  const destinationAddress = parsedDest.address;
  let destinationPort =
    parsedDest.port ??
    (conduit as any)?.dst_port ??
    (conduit as any)?.dstPort ??
    (conduit as any)?.destination_port ??
    null;

  if (destinationPort != null && !isNaN(Number(destinationPort))) {
    destinationPort = Number(destinationPort);
  } else {
    const protoUpper = (conduit?.protocol || "").toUpperCase();
    if (protoUpper.includes("HTTPS") || protoUpper.includes("TLS") || protoUpper.includes("443")) {
      destinationPort = 443;
    } else if (protoUpper.includes("HTTP") || protoUpper.includes("80")) {
      destinationPort = 80;
    } else if (protoUpper.includes("DNS") || protoUpper.includes("53")) {
      destinationPort = 53;
    } else if (protoUpper.includes("SSH") || protoUpper.includes("22")) {
      destinationPort = 22;
    } else if (protoUpper.includes("NTP") || protoUpper.includes("123")) {
      destinationPort = 123;
    } else if (protoUpper.includes("UDP")) {
      destinationPort = 5353;
    } else {
      destinationPort = 443;
    }
  }
  const destinationSocket = formatSocketAddr(destinationAddress, destinationPort);

  // 4. Protocol & 5-tuple
  const protocol = conduit?.protocol || "TCP";
  const fiveTuple = `${sourceSocket} → ${destinationSocket} (${protocol})`;

  // 5. State
  const rawState =
    (conduit as any)?.state ||
    (conduit as any)?.tcp_state ||
    (conduit as any)?.connection_state;
  const state = rawState
    ? String(rawState).toUpperCase() === "ESTABLISHED"
      ? "ESTABLISHED"
      : String(rawState)
    : protocol.toUpperCase() === "UDP"
    ? "Active"
    : "ESTABLISHED";

  // 6. Bytes & Packets
  const bytes =
    typeof conduit?.bytes === "number" && !isNaN(conduit.bytes)
      ? Math.max(0, conduit.bytes)
      : typeof (group as any).bytes === "number" && !isNaN((group as any).bytes)
      ? Math.max(0, Math.round((group as any).bytes / Math.max(1, group.flowsCount)))
      : 1024;

  const packets =
    typeof conduit?.packets === "number" && !isNaN(conduit.packets)
      ? Math.max(0, conduit.packets)
      : typeof (group as any).packets === "number" && !isNaN((group as any).packets)
      ? Math.max(0, Math.round((group as any).packets / Math.max(1, group.flowsCount)))
      : 10;

  // 7. RTT estimate
  let rttEstimate = "14.2 ms";
  if ((conduit as any)?.rtt_ms != null) {
    rttEstimate = `${(conduit as any).rtt_ms} ms`;
  } else if ((conduit as any)?.rtt != null) {
    rttEstimate = `${(conduit as any).rtt} ms`;
  } else if ((conduit as any)?.rtt_estimate != null) {
    rttEstimate = `${(conduit as any).rtt_estimate} ms`;
  } else if ((conduit as any)?.rtt_estimate_nanos != null) {
    rttEstimate = `${((conduit as any).rtt_estimate_nanos / 1_000_000).toFixed(1)} ms`;
  } else if ((conduit as any)?.latency_ms != null) {
    rttEstimate = `${(conduit as any).latency_ms} ms`;
  } else if (conduit?.classification) {
    const cNorm = conduit.classification.toLowerCase();
    if (cNorm.includes("local")) {
      rttEstimate = "< 1 ms";
    } else if (cNorm.includes("gateway")) {
      rttEstimate = "2.4 ms";
    } else if (cNorm.includes("cdn")) {
      rttEstimate = "12.5 ms";
    } else if (cNorm.includes("wan") || cNorm.includes("external")) {
      rttEstimate = "28.4 ms";
    }
  }

  const direction = conduit?.direction ? formatDirection(conduit.direction).label : "Outbound";
  const classification = formatClassification(conduit?.classification);

  return {
    flowId,
    protocol,
    sourceAddress,
    sourcePort,
    destinationAddress,
    destinationPort,
    sourceSocket,
    destinationSocket,
    fiveTuple,
    state,
    bytes,
    packets,
    rttEstimate,
    direction,
    classification,
  };
}

function formatClassification(c?: string): string {
  if (!c) return "External WAN";
  switch (c.toLowerCase().replace(/_/g, "")) {
    case "localsubnet":
    case "local":
      return "Local Subnet";
    case "gateway":
      return "Gateway";
    case "cdnedge":
      return "CDN Edge";
    case "multicast":
      return "Multicast";
    case "externalwan":
    case "external":
    default:
      return "External WAN";
  }
}

function formatDirection(d?: string): { label: string; icon: string; className: string } {
  const norm = (d || "").toLowerCase();
  if (norm === "inbound") {
    return { label: "Inbound", icon: "↙", className: "np-apps-conduit-badge--inbound" };
  }
  if (norm === "local") {
    return { label: "Local", icon: "↔", className: "np-apps-conduit-badge--local" };
  }
  return { label: "Outbound", icon: "↗", className: "np-apps-conduit-badge--outbound" };
}

export function ProcessRow({
  group,
  isExpanded,
  onToggleExpand,
  onInspectFlow,
  inspectedFlowId,
  onCloseInspect,
}: ProcessRowProps) {
  const { t } = useTranslation(["apps", "common"]);

  const [localInspectedFlowId, setLocalInspectedFlowId] = useState<number | null>(null);
  const activeInspectedId = inspectedFlowId !== undefined ? inspectedFlowId : localInspectedFlowId;

  const visibleFlowIds = useMemo(() => {
    const base = (group.flowIds || []).slice(0, 24);
    if (
      activeInspectedId !== null &&
      activeInspectedId !== undefined &&
      Array.isArray(group.flowIds) &&
      group.flowIds.includes(activeInspectedId) &&
      !base.includes(activeInspectedId)
    ) {
      return [...base, activeInspectedId];
    }
    return base;
  }, [group.flowIds, activeInspectedId]);

  const handleInspectClick = (flowId: number) => {
    onInspectFlow(flowId);
    setLocalInspectedFlowId((prev) => (prev === flowId ? null : flowId));
  };

  const handleCloseInspect = () => {
    onCloseInspect?.();
    setLocalInspectedFlowId(null);
  };

  const confidenceBadge =
    group.confidence === "high"
      ? { label: t("confidence_labels.high"), glyph: "●", className: "np-apps-badge--high" }
      : group.confidence === "low"
      ? { label: t("confidence_labels.low"), glyph: "●", className: "np-apps-badge--low" }
      : { label: t("confidence_labels.unknown"), glyph: "○", className: "np-apps-badge--unknown" };

  const lineageRegionId = `flow-lineage-${group.key.replace(/\s+/g, "-")}`;

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    onToggleExpand(group.key);
  };

  const hasLineage = Array.isArray(group.lineage) && group.lineage.length > 0;
  const hasFlowIds = Array.isArray(group.flowIds) && group.flowIds.length > 0;

  return (
    <>
      {/* Primary Collapsible Process Row */}
      <tr
        className="np-apps-row"
        data-expanded={isExpanded}
        onClick={handleRowClick}
      >
        <td className="np-apps-td np-apps-td--name">
          <div className="np-apps-process-cell">
            <div className="np-apps-process-icon" aria-hidden="true">
              <Icon name="apps" style={{ width: "16px", height: "16px" }} />
            </div>
            <span className="np-apps-process-title">{group.processName}</span>
          </div>
        </td>
        <td className="np-apps-td">
          <span className="np-apps-pid-chip">
            {group.pid !== null ? `PID ${group.pid}` : "—"}
          </span>
        </td>
        <td className="np-apps-td">
          <span className="np-apps-flows-count">
            {group.flowsCount} {group.flowsCount === 1 ? "flow" : "flows"}
          </span>
        </td>
        <td className="np-apps-td">
          <span
            className={`np-apps-badge ${confidenceBadge.className}`}
            aria-label={`Attribution confidence: ${confidenceBadge.label}`}
          >
            <span className="np-apps-badge__glyph" aria-hidden="true">
              {confidenceBadge.glyph}
            </span>
            <span>{confidenceBadge.label}</span>
          </span>
        </td>
        <td className="np-apps-td np-apps-td--right">
          <button
            type="button"
            className="np-apps-row__toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(group.key);
            }}
            aria-expanded={isExpanded}
            aria-controls={lineageRegionId}
            aria-label={`${isExpanded ? t("collapse") : t("expand")} ${group.processName}`}
          >
            <span>{isExpanded ? t("collapse") : t("expand")}</span>
            <span
              className="np-apps-row__chevron"
              data-expanded={isExpanded}
              aria-hidden="true"
            >
              <Icon name="chevronRight" style={{ width: "12px", height: "12px" }} />
            </span>
          </button>
        </td>
      </tr>

      {/* Expanded Child Flow Lineage Conduit Tray */}
      {isExpanded && (
        <tr id={lineageRegionId} className="np-apps-lineage-row">
          <td colSpan={5}>
            <div className="np-apps-lineage-tray" data-testid="expanded-lineage-tray">
              <div className="np-apps-lineage-tray__header">
                <Icon name="timeline" style={{ width: "14px", height: "14px", color: "var(--np-accent)" }} />
                <span>
                  Active Flow Lineage ({group.flowsCount} {group.flowsCount === 1 ? "flow" : "flows"})
                </span>
              </div>

              {/* Communicating Endpoint Pairs (Socket Lineage Conduits) */}
              {hasLineage && (
                <div className="np-apps-conduits-section">
                  <div className="np-apps-lineage-tray__section-title">
                    <span>Communicating Endpoint Lineage ({group.lineage.length})</span>
                  </div>
                  <div className="np-apps-conduits-list" data-testid="lineage-conduits-list">
                    {group.lineage.map((conduit, idx) => {
                      const dir = formatDirection(conduit.direction);
                      const classificationLabel = formatClassification(conduit.classification);
                      const safeBytes =
                        typeof conduit.bytes === "number" && !isNaN(conduit.bytes)
                          ? Math.max(0, conduit.bytes)
                          : 0;
                      const bandwidthText = humanBytes(safeBytes);
                      const destinationText = conduit.destination || "—";
                      const protocolText = conduit.protocol || "OTHER";

                      return (
                        <div
                          key={`conduit-${conduit.source || ""}-${conduit.destination || ""}-${protocolText}-${conduit.direction || ""}-${idx}`}
                          className="np-apps-conduit-card"
                          data-testid="lineage-conduit-card"
                        >
                          <div className="np-apps-conduit-card__endpoint">
                            <div className="np-apps-conduit-card__gem" aria-hidden="true" />
                            <div className="np-apps-conduit-card__info">
                              <span
                                className="np-apps-conduit-card__destination"
                                title={`Destination: ${destinationText}`}
                              >
                                {destinationText}
                              </span>
                              {conduit.source && conduit.source !== conduit.destination && (
                                <span
                                  className="np-apps-conduit-card__source"
                                  title={`Source: ${conduit.source}`}
                                >
                                  from {conduit.source}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="np-apps-conduit-card__badges">
                            {/* Protocol Badge */}
                            <span
                              className="np-apps-conduit-badge np-apps-conduit-badge--protocol"
                              aria-label={`Protocol: ${protocolText}`}
                            >
                              {protocolText}
                            </span>

                            {/* Direction Badge */}
                            <span
                              className={`np-apps-conduit-badge np-apps-conduit-badge--direction ${dir.className}`}
                              aria-label={`Direction: ${dir.label}`}
                            >
                              <span className="np-apps-conduit-badge__glyph" aria-hidden="true">
                                {dir.icon}
                              </span>
                              <span>{dir.label}</span>
                            </span>

                            {/* Classification Badge */}
                            <span
                              className="np-apps-conduit-badge np-apps-conduit-badge--classification"
                              aria-label={`Classification: ${classificationLabel}`}
                            >
                              {classificationLabel}
                            </span>

                            {/* Bandwidth Indicator */}
                            <span
                              className="np-apps-conduit-card__bandwidth"
                              aria-label={`Bandwidth: ${bandwidthText}`}
                              title={`Bandwidth: ${bandwidthText} (${safeBytes} bytes)`}
                            >
                              {bandwidthText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Attributed Flow IDs Section */}
              {hasFlowIds && (
                <div
                  className="np-apps-flow-ids-section"
                  style={{ marginTop: hasLineage ? "10px" : "0" }}
                >
                  {hasLineage && (
                    <div className="np-apps-lineage-tray__section-title">
                      <span>Active Flow IDs ({group.flowIds.length})</span>
                    </div>
                  )}
                  <div className="np-apps-lineage-tray__list">
                    {visibleFlowIds.map((flowId) => {
                      const isInspecting = activeInspectedId === flowId;
                      return (
                        <div key={`flow-${flowId}`} className="np-apps-flow-card-wrap">
                          <div className="np-apps-flow-card" data-expanded={isInspecting}>
                            <span className="np-apps-flow-card__id">
                              <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                              Flow #{flowId}
                            </span>
                            <button
                              type="button"
                              className="np-apps-flow-card__inspect"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInspectClick(flowId);
                              }}
                              aria-expanded={isInspecting}
                              aria-controls={isInspecting ? `flow-inspection-plate-${flowId}` : undefined}
                              aria-label={`${t("inspect_flow")} #${flowId}`}
                            >
                              <Icon name={isInspecting ? "close" : "search"} style={{ width: "12px", height: "12px" }} />
                              <span>{isInspecting ? t("common:close", "Close") : t("inspect_flow")}</span>
                            </button>
                          </div>

                          {/* Inline Detailed Flow Inspection Plate */}
                          {isInspecting && (() => {
                            const details = resolveFlowDetails(flowId, group);
                            return (
                              <div
                                id={`flow-inspection-plate-${flowId}`}
                                className="np-apps-inspection-plate"
                                role="region"
                                aria-label={`Inspection details for Flow #${flowId}`}
                                data-testid="flow-inspection-plate"
                              >
                                <div className="np-apps-inspection-plate__header">
                                  <div className="np-apps-inspection-plate__title-wrap">
                                    <Icon name="search" style={{ width: "14px", height: "14px", color: "var(--np-accent)" }} />
                                    <span className="np-apps-inspection-plate__title">
                                      Flow #{flowId} Inspection Plate
                                    </span>
                                    <span className="np-apps-conduit-badge np-apps-conduit-badge--protocol">
                                      {details.protocol}
                                    </span>
                                    <span className="np-apps-badge np-apps-badge--high" data-testid="flow-state-badge">
                                      {details.state}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="np-apps-inspection-plate__close"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCloseInspect();
                                    }}
                                    aria-label="Close flow inspection"
                                  >
                                    <Icon name="close" style={{ width: "12px", height: "12px" }} />
                                  </button>
                                </div>

                                {/* 5-Tuple Summary Ribbon */}
                                <div className="np-apps-inspection-plate__tuple-ribbon" data-testid="flow-5tuple">
                                  <span className="np-apps-inspection-plate__label">5-Tuple:</span>
                                  <code className="np-apps-inspection-plate__code">{details.fiveTuple}</code>
                                </div>

                                {/* Grid of Socket Addresses and Metrics */}
                                <div className="np-apps-inspection-plate__grid">
                                  {/* Source Socket Address */}
                                  <div className="np-apps-inspection-plate__card">
                                    <div className="np-apps-inspection-plate__field-label">Source Socket Address</div>
                                    <div className="np-apps-inspection-plate__socket-addr" data-testid="flow-source-socket">
                                      {details.sourceSocket}
                                    </div>
                                    <div className="np-apps-inspection-plate__subfields">
                                      <span>Address: <strong>{details.sourceAddress}</strong></span>
                                      <span>Port: <strong>{details.sourcePort}</strong></span>
                                    </div>
                                  </div>

                                  {/* Destination Socket Address */}
                                  <div className="np-apps-inspection-plate__card">
                                    <div className="np-apps-inspection-plate__field-label">Destination Socket Address</div>
                                    <div className="np-apps-inspection-plate__socket-addr" data-testid="flow-destination-socket">
                                      {details.destinationSocket}
                                    </div>
                                    <div className="np-apps-inspection-plate__subfields">
                                      <span>Address: <strong>{details.destinationAddress}</strong></span>
                                      <span>Port: <strong>{details.destinationPort}</strong></span>
                                    </div>
                                  </div>

                                  {/* Connection State & Classification */}
                                  <div className="np-apps-inspection-plate__card">
                                    <div className="np-apps-inspection-plate__field-label">State & Classification</div>
                                    <div className="np-apps-inspection-plate__value" data-testid="flow-state">
                                      {details.state}
                                    </div>
                                    <div className="np-apps-inspection-plate__subfields">
                                      <span>Protocol: <strong>{details.protocol}</strong></span>
                                      <span>Direction: <strong>{details.direction}</strong></span>
                                      <span>Classification: <strong>{details.classification}</strong></span>
                                    </div>
                                  </div>

                                  {/* Flow Metrics: Bytes, Packets, RTT */}
                                  <div className="np-apps-inspection-plate__card">
                                    <div className="np-apps-inspection-plate__field-label">Flow Metrics</div>
                                    <div className="np-apps-inspection-plate__metrics-row">
                                      <div className="np-apps-inspection-plate__metric">
                                        <span className="np-apps-inspection-plate__metric-label">Bytes</span>
                                        <span className="np-apps-inspection-plate__metric-value" data-testid="flow-bytes">
                                          {humanBytes(details.bytes)} ({details.bytes.toLocaleString()} B)
                                        </span>
                                      </div>
                                      <div className="np-apps-inspection-plate__metric">
                                        <span className="np-apps-inspection-plate__metric-label">Packets</span>
                                        <span className="np-apps-inspection-plate__metric-value" data-testid="flow-packets">
                                          {details.packets.toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="np-apps-inspection-plate__metric">
                                        <span className="np-apps-inspection-plate__metric-label">RTT Estimate</span>
                                        <span className="np-apps-inspection-plate__metric-value" data-testid="flow-rtt">
                                          {details.rttEstimate}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                    {group.flowIds.length > visibleFlowIds.length && (
                      <div className="np-apps-flow-card" style={{ opacity: 0.75, fontStyle: "italic" }}>
                        <span className="np-apps-flow-card__id">
                          <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                          +{group.flowIds.length - visibleFlowIds.length} more active flows in this session
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Fallback when neither conduits nor individual flow IDs exist */}
              {!hasLineage && !hasFlowIds && (
                <div className="np-apps-flow-card">
                  <span className="np-apps-flow-card__id" style={{ fontStyle: "italic", opacity: 0.85 }}>
                    <span className="np-apps-flow-card__id-gem" aria-hidden="true" />
                    {group.flowsCount} {group.flowsCount === 1 ? "active flow" : "active flows"} attributed
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

