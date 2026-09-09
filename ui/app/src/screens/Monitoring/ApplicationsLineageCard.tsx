import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { humanBytes, TopologyGraph, type TopologyNode, type TopologyEdge } from "@netpulse/viz";
import type { FlowLineage as FlowLineageDto } from "@netpulse/contract";
import { useStore } from "../../state/store";
import { Icon } from "../../icons";

export type { FlowLineageDto };

export interface ApplicationsLineageCardProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
  lineage?: FlowLineageDto[];
}

export function findMatchingLineage(
  node: TopologyNode,
  lineage: FlowLineageDto[]
): FlowLineageDto | undefined {
  if (!node || !lineage || lineage.length === 0) return undefined;

  const rawId = node.id;
  const strippedId = rawId.startsWith("node-") ? rawId.slice(5) : rawId;

  // 1. Direct id match if item has an id property
  const idMatch = lineage.find((item) => (item as { id?: string }).id === rawId);
  if (idMatch) return idMatch;

  const isExplicitSource = node.sublabel === "SRC";

  const matchDestination = () =>
    lineage.find(
      (item) =>
        rawId === `node-${item.destination}` ||
        rawId === item.destination ||
        strippedId === item.destination ||
        (node.label && node.label === item.destination)
    );

  const matchSource = () =>
    lineage.find(
      (item) =>
        rawId === `node-${item.source}` ||
        rawId === item.source ||
        strippedId === item.source ||
        (node.label && node.label === item.source)
    );

  if (isExplicitSource) {
    return matchSource() ?? matchDestination();
  }

  return matchDestination() ?? matchSource();
}

export type LineageFilterMode =
  | "All Endpoints"
  | "External WAN"
  | "Local Subnet"
  | "CDN Edge"
  | "Multicast";

export const FILTER_MODES: readonly LineageFilterMode[] = [
  "All Endpoints",
  "External WAN",
  "Local Subnet",
  "CDN Edge",
  "Multicast",
];

export function ApplicationsLineageCard({
  nodes = [],
  edges = [],
  selectedNodeId,
  onSelectNode,
  lineage: propLineage,
}: ApplicationsLineageCardProps) {
  const { t } = useTranslation(["monitoring"]);
  const [filterMode, setFilterMode] = useState<LineageFilterMode>("All Endpoints");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Map<LineageFilterMode, HTMLButtonElement>>(new Map());
  const { monitor } = useStore();
  const lineage = propLineage ?? monitor?.lineage ?? [];

  const formatFilterMode = (mode: LineageFilterMode): string => {
    switch (mode) {
      case "All Endpoints":
        return t("applications_lineage.filters.all_endpoints", "All Endpoints");
      case "External WAN":
        return t("applications_lineage.filters.external_wan", "External WAN");
      case "Local Subnet":
        return t("applications_lineage.filters.local_subnet", "Local Subnet");
      case "CDN Edge":
        return t("applications_lineage.filters.cdn_edge", "CDN Edge");
      case "Multicast":
        return t("applications_lineage.filters.multicast", "Multicast");
      default:
        return mode;
    }
  };

  // Focus selected option when dropdown opens
  useEffect(() => {
    if (showDropdown) {
      const selectedEl = optionRefs.current.get(filterMode);
      selectedEl?.focus();
    }
  }, [showDropdown]);

  // Close dropdown on Escape key or outside click
  useEffect(() => {
    if (!showDropdown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowDropdown(false);
        triggerBtnRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  // Filter nodes & edges based on classification
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (filterMode === "External WAN") {
    const wanNodes = new Set(nodes.filter((n) => n.sublabel === "EXTERNAL_WAN").map((n) => n.id));
    filteredEdges = edges.filter((e) => wanNodes.has(e.source) || wanNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || wanNodes.has(n.id));
  } else if (filterMode === "Local Subnet") {
    const localNodes = new Set(
      nodes.filter((n) => n.sublabel === "LOCAL" || n.sublabel === "LOCAL_SUBNET").map((n) => n.id)
    );
    filteredEdges = edges.filter((e) => localNodes.has(e.source) || localNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || localNodes.has(n.id));
  } else if (filterMode === "CDN Edge") {
    const cdnNodes = new Set(nodes.filter((n) => n.sublabel === "CDN_EDGE").map((n) => n.id));
    filteredEdges = edges.filter((e) => cdnNodes.has(e.source) || cdnNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || cdnNodes.has(n.id));
  } else if (filterMode === "Multicast") {
    const mcNodes = new Set(nodes.filter((n) => n.sublabel === "MULTICAST").map((n) => n.id));
    filteredEdges = edges.filter((e) => mcNodes.has(e.source) || mcNodes.has(e.target));
    const activeIds = new Set(filteredEdges.flatMap((e) => [e.source, e.target]));
    filteredNodes = nodes.filter((n) => activeIds.has(n.id) || mcNodes.has(n.id));
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div
      className="np-monitor-card"
      aria-label={t("applications_lineage.aria_label", "Applications & Lineage Topology Graph")}
      style={{ justifyContent: "flex-start" }}
    >
      <div className="np-monitor-card__header">
        <h3 className="np-monitor-card__title">{t("applications_lineage.title", "Applications & Lineage")}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", position: "relative" }} ref={dropdownRef}>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)" }}>
            {t("applications_lineage.active_nodes", { count: filteredNodes.length, defaultValue: `${filteredNodes.length} Active Nodes` })}
          </span>
          <button
            ref={triggerBtnRef}
            type="button"
            className="np-monitor-badge"
            style={{
              background: "var(--np-surface-raised, var(--np-surface-1))",
              color: "var(--np-text)",
              cursor: "pointer",
              border: "1px solid var(--np-border)",
              fontSize: "0.75rem",
              padding: "0.25rem 0.65rem",
              borderRadius: "var(--np-radius-sm)",
              boxShadow: "var(--np-neu-control)",
              outline: "none",
            }}
            onClick={() => setShowDropdown((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!showDropdown) {
                  setShowDropdown(true);
                } else {
                  optionRefs.current.get(filterMode)?.focus();
                }
              }
            }}
            aria-expanded={showDropdown}
            aria-haspopup="listbox"
            aria-controls={showDropdown ? "lineage-filter-listbox" : undefined}
            aria-label={t("applications_lineage.filter_aria_label", "Filter lineage topology rules")}
          >
            {formatFilterMode(filterMode)} ▾
          </button>

          {showDropdown && (
            <div
              id="lineage-filter-listbox"
              role="listbox"
              aria-label={t("applications_lineage.options_aria_label", "Topology rules options")}
              tabIndex={-1}
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "6px",
                background: "var(--np-surface-overlay, var(--np-surface-1))",
                border: "1px solid var(--np-border-strong)",
                borderRadius: "var(--np-radius-sm)",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                zIndex: "var(--np-z-overlay, 100)",
                boxShadow: "var(--np-neu-overlay)",
                minWidth: "160px",
                backdropFilter: "var(--np-glass-blur)",
              }}
            >
              {FILTER_MODES.map((mode, idx) => {
                const isSelected = filterMode === mode;
                return (
                  <button
                    key={mode}
                    ref={(el) => {
                      if (el) {
                        optionRefs.current.set(mode, el);
                      } else {
                        optionRefs.current.delete(mode);
                      }
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    style={{
                      background: isSelected ? "var(--np-surface-2)" : "transparent",
                      color: isSelected ? "var(--np-accent-strong, var(--np-text))" : "var(--np-text)",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "var(--np-radius-xs)",
                      fontSize: "0.78rem",
                      textAlign: "left",
                      cursor: "pointer",
                      fontWeight: isSelected ? 600 : 400,
                      outline: "none",
                      transition: "all var(--np-t)",
                    }}
                    onClick={() => {
                      setFilterMode(mode);
                      setShowDropdown(false);
                      triggerBtnRef.current?.focus();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        const nextIdx = (idx + 1) % FILTER_MODES.length;
                        optionRefs.current.get(FILTER_MODES[nextIdx]!)?.focus();
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        const prevIdx = (idx - 1 + FILTER_MODES.length) % FILTER_MODES.length;
                        optionRefs.current.get(FILTER_MODES[prevIdx]!)?.focus();
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        optionRefs.current.get(FILTER_MODES[0]!)?.focus();
                      } else if (e.key === "End") {
                        e.preventDefault();
                        optionRefs.current.get(FILTER_MODES[FILTER_MODES.length - 1]!)?.focus();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setShowDropdown(false);
                        triggerBtnRef.current?.focus();
                      } else if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setFilterMode(mode);
                        setShowDropdown(false);
                        triggerBtnRef.current?.focus();
                      } else if (e.key === "Tab") {
                        setShowDropdown(false);
                      }
                    }}
                  >
                    {formatFilterMode(mode)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {filteredNodes.length === 0 ? (
        <div
          style={{
            height: 240,
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
          <Icon name="radio" style={{ width: "24px", height: "24px", color: "var(--np-accent)" }} />
          <span>{t("applications_lineage.empty_standby", "Capture Standby — Start a packet capture to observe live network flow lineage.")}</span>
        </div>
      ) : (
        <TopologyGraph
          nodes={filteredNodes}
          edges={filteredEdges}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id: string) => onSelectNode?.(id === selectedNodeId ? null : id)}
          height={240}
        />
      )}

      {/* Node Inspection Detail Popover — Level 4 Overlay Plate */}
      {selectedNode && (() => {
        const item = findMatchingLineage(selectedNode, lineage);
        const classification = item?.classification || selectedNode.sublabel || t("applications_lineage.nominal", "Nominal");
        const protocol = item?.protocol || t("applications_lineage.active_flow", "Active Flow");
        const bytesText =
          typeof item?.bytes === "number" && !isNaN(item.bytes)
            ? humanBytes(Math.max(0, item.bytes))
            : null;

        return (
          <div
            style={{
              background: "var(--np-surface-raised, var(--np-surface-1))",
              border: "1px solid var(--np-border)",
              borderRadius: "var(--np-radius-sm)",
              padding: "0.6rem 0.85rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.825rem",
              boxShadow: "var(--np-neu-card)",
              marginTop: "auto",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: "var(--np-text)" }}>
                {selectedNode.label} ({selectedNode.status})
              </div>
              <div style={{ color: "var(--np-text-dim)", fontSize: "0.75rem", marginTop: "2px" }}>
                {bytesText != null
                  ? t("applications_lineage.details_with_bytes", {
                      classification,
                      bytes: bytesText,
                      protocol,
                      defaultValue: `Classification: ${classification} • ${bytesText} • Protocol: ${protocol} • Active`,
                    })
                  : t("applications_lineage.details_without_bytes", {
                      classification,
                      protocol,
                      defaultValue: `Classification: ${classification} • Protocol: ${protocol} • Active`,
                    })}
              </div>
            </div>
            <button
              type="button"
              className="np-monitor-icon-btn"
              style={{ padding: "4px 6px" }}
              onClick={() => onSelectNode?.(null)}
              aria-label={t("applications_lineage.close_details", "Close node details")}
            >
              <Icon name="close" style={{ width: "12px", height: "12px" }} />
            </button>
          </div>
        );
      })()}
    </div>
  );
}

