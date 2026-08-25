import { useState, useMemo, memo } from "react";
import { type SelectedEntity, type EnrichedHost, makeHostEntityId, makeAsnEntityId, humanBytes } from "@netpulse/viz";
import { EvidenceChips } from "@netpulse/components";
import { useOptionalEvidenceNavigation } from "../../context/EvidenceNavigationContext";
import { useOptionalSidebar } from "./RightRailContext";
import { Icon } from "../../icons";

export interface GeoContextCardProps {
  entity: SelectedEntity | null;
  onClearSelection?: () => void;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
}

export const GeoContextCard = memo(function GeoContextCard({
  entity,
  onClearSelection,
  onSelectEntity,
}: GeoContextCardProps) {
  const navContext = useOptionalEvidenceNavigation();
  const navigateToEvidence = navContext?.navigateToEvidence ?? (() => {});
  const sidebar = useOptionalSidebar();

  if (!entity) return null;

  if (entity.kind === "endpoint") {
    const h = entity.host;
    const isTombstone = Boolean(entity.tombstone?.isInactive || !h);

    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Selected Host Telemetry">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className={`np-badge ${isTombstone ? "np-badge--warning" : "np-badge--accent"}`}>
              {isTombstone ? "Inactive Endpoint" : h?.classification.categoryLabel || "Endpoint"}
            </span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {h?.hostnames[0]?.name || entity.ip} {isTombstone ? "(Inactive)" : ""}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {isTombstone && entity.tombstone && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: "var(--np-radius-sm, 6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--np-warning, #f59e0b)", fontWeight: 600, fontSize: "0.75rem" }}>
              <Icon name="alertTriangle" style={{ width: "14px", height: "14px" }} />
              <span>No longer active in live window</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--np-text-dim, #94a3b8)" }}>
              Historical snapshot retained. Observed {humanBytes(entity.tombstone.lastObservedBytes)} across {entity.tombstone.lastObservedFlows} flows before becoming inactive.
            </p>
          </div>
        )}

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>IP Address</span>
            <span className="np-rail-list__val">{h?.ip || entity.ip}</span>
          </li>
          {h && (
            <li>
              <span>Classification</span>
              <span className="np-rail-list__val">{h.classification.category}</span>
            </li>
          )}
          {h?.geo.status === "resolved" && (
            <>
              <li>
                <span>Location</span>
                <span className="np-rail-list__val">
                  {h.geo.city ? `${h.geo.city}, ${h.geo.countryCode}` : h.geo.country}
                </span>
              </li>
              <li>
                <span>Coordinates</span>
                <span className="np-rail-list__val">
                  {h.geo.latitude.toFixed(2)}°, {h.geo.longitude.toFixed(2)}°
                </span>
              </li>
              <li>
                <span>Geographic Precision</span>
                <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent-strong)" }}>
                  {h.geo.locationLevel === "city" ? "City estimate" : "Country representation (centroid)"}
                </span>
              </li>
            </>
          )}
          {h?.geo.status === "unresolved" && (
            <li>
              <span>Location</span>
              <span className="np-rail-list__val" style={{ color: "var(--np-text-mute)" }}>
                {h.geo.reason === "ipv6_deferred"
                  ? "Unresolved (IPv6 GeoIP deferred)"
                  : `Unresolved (${h.geo.reason})`}
              </span>
            </li>
          )}
          {(() => {
            const asRes = h?.asn;
            if (!asRes || asRes.status !== "resolved") return null;
            const resolvedAsn = asRes.asn;
            const resolvedOrg = asRes.asOrg;
            return (
              <>
                <li>
                  <span>ASN</span>
                  <span className="np-rail-list__val">
                    {onSelectEntity ? (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectEntity({
                            kind: "asn",
                            asn: resolvedAsn,
                            asOrg: resolvedOrg,
                            entityId: makeAsnEntityId(resolvedAsn),
                            memberHosts: [h],
                          })
                        }
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "var(--np-accent, #2fe0d6)",
                          cursor: "pointer",
                          textDecoration: "underline",
                          font: "inherit",
                        }}
                        title={`Inspect Autonomous System AS${resolvedAsn}`}
                      >
                        AS{resolvedAsn}
                      </button>
                    ) : (
                      `AS${resolvedAsn}`
                    )}
                  </span>
                </li>
                <li>
                  <span>Organization</span>
                  <span className="np-rail-list__val">{resolvedOrg}</span>
                </li>
              </>
            );
          })()}
          {h && (
            <>
              <li>
                <span>Total Volume</span>
                <span className="np-rail-list__val">{humanBytes(h.bytes)}</span>
              </li>
              <li>
                <span>Flows</span>
                <span className="np-rail-list__val">{h.flows}</span>
              </li>
              <li>
                <span>Telemetry State</span>
                <span className="np-rail-list__val">{h.freshness.toUpperCase()}</span>
              </li>
            </>
          )}
        </ul>

        {h?.evidence && h.evidence.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)", display: "block", marginBottom: "4px" }}>
              ASSOCIATED EVIDENCE:
            </span>
            <EvidenceChips
              evidence={h.evidence}
              onNavigate={(ref) => navigateToEvidence(ref, "feed")}
            />
          </div>
        )}
      </section>
    );
  }

  if (entity.kind === "countryAggregate") {
    const isTombstone = Boolean(entity.tombstone?.isInactive);
    const totalBytes = entity.node?.totalBytes ?? entity.tombstone?.lastObservedBytes ?? 0;
    const totalFlows = entity.node?.totalFlows ?? entity.tombstone?.lastObservedFlows ?? 0;
    const endpointCount = entity.node?.memberCount ?? entity.memberCount ?? entity.memberHosts.length;
    const isSampled = entity.memberHosts.length < endpointCount;

    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Country Aggregate Summary">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className={`np-badge ${isTombstone ? "np-badge--warning" : "np-badge--accent"}`}>Country Aggregate</span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {entity.countryName} ({entity.countryCode}) {isTombstone ? "(Inactive)" : ""}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {isTombstone && entity.tombstone && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: "var(--np-radius-sm, 6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--np-warning, #f59e0b)", fontWeight: 600, fontSize: "0.75rem" }}>
              <Icon name="alertTriangle" style={{ width: "14px", height: "14px" }} />
              <span>No longer active in live window</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--np-text-dim, #94a3b8)" }}>
              Historical snapshot retained. Observed {humanBytes(entity.tombstone.lastObservedBytes)} across {entity.tombstone.lastObservedFlows} flows before becoming inactive.
            </p>
          </div>
        )}

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Endpoints</span>
            <span className="np-rail-list__val">{endpointCount} hosts</span>
          </li>
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
          </li>
          <li>
            <span>Total Flows</span>
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
          {entity.node && (
            <li>
              <span>Autonomous Systems</span>
              <span className="np-rail-list__val">
                {entity.node.asns.length > 0 ? entity.node.asns.map((a: number) => `AS${a}`).join(", ") : "None"}
              </span>
            </li>
          )}
        </ul>

        {entity.memberHosts.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)", display: "block" }}>
                {isSampled
                  ? `SAMPLE ENDPOINTS (${entity.memberHosts.length} OF ${endpointCount}):`
                  : `MEMBER ENDPOINTS (${entity.memberHosts.length}):`}
              </span>
              {isSampled && (
                <span style={{ fontSize: "0.65rem", color: "var(--np-accent, #2fe0d6)" }}>
                  Showing a sample of {entity.memberHosts.length} endpoints
                </span>
              )}
            </div>
            {isSampled && (
              <p style={{ margin: "0 0 6px", fontSize: "0.7rem", color: "var(--np-text-dim, #94a3b8)" }}>
                Displaying a representative sample of {entity.memberHosts.length} out of {endpointCount} total endpoints.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "120px", overflowY: "auto" }}>
              {entity.memberHosts.map((m: EnrichedHost) => (
                <span key={m.ip} className="np-pill" style={{ fontSize: "0.68rem" }}>
                  {m.hostnames[0]?.name || m.ip} • {humanBytes(m.bytes)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (entity.kind === "cluster") {
    const isTombstone = Boolean(entity.tombstone?.isInactive);
    const totalBytes = entity.node?.totalBytes ?? entity.tombstone?.lastObservedBytes ?? 0;
    const totalFlows = entity.node?.totalFlows ?? entity.tombstone?.lastObservedFlows ?? 0;
    const endpointCount = entity.node?.memberCount ?? entity.memberCount ?? entity.memberHosts.length;
    const isSampled = entity.memberHosts.length < endpointCount;

    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Spatial Cluster Summary">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className={`np-badge ${isTombstone ? "np-badge--warning" : "np-badge--accent"}`}>Spatial Cluster</span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {entity.label} {isTombstone ? "(Inactive)" : ""}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {isTombstone && entity.tombstone && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: "var(--np-radius-sm, 6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--np-warning, #f59e0b)", fontWeight: 600, fontSize: "0.75rem" }}>
              <Icon name="alertTriangle" style={{ width: "14px", height: "14px" }} />
              <span>No longer active in live window</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--np-text-dim, #94a3b8)" }}>
              Historical snapshot retained. Observed {humanBytes(entity.tombstone.lastObservedBytes)} across {entity.tombstone.lastObservedFlows} flows before becoming inactive.
            </p>
          </div>
        )}

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Clustered Endpoints</span>
            <span className="np-rail-list__val">{endpointCount} hosts</span>
          </li>
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
          </li>
          <li>
            <span>Total Flows</span>
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
          {entity.node && (
            <li>
              <span>Autonomous Systems</span>
              <span className="np-rail-list__val">
                {entity.node.asns.length > 0 ? entity.node.asns.map((a: number) => `AS${a}`).join(", ") : "None"}
              </span>
            </li>
          )}
        </ul>

        {entity.memberHosts.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)", display: "block" }}>
                {isSampled
                  ? `SAMPLE ENDPOINTS (${entity.memberHosts.length} OF ${endpointCount}):`
                  : `CLUSTER ENDPOINTS (${entity.memberHosts.length}):`}
              </span>
              {isSampled && (
                <span style={{ fontSize: "0.65rem", color: "var(--np-accent, #2fe0d6)" }}>
                  Showing a sample of {entity.memberHosts.length} endpoints
                </span>
              )}
            </div>
            {isSampled && (
              <p style={{ margin: "0 0 6px", fontSize: "0.7rem", color: "var(--np-text-dim, #94a3b8)" }}>
                Displaying a representative sample of {entity.memberHosts.length} out of {endpointCount} total endpoints.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "140px", overflowY: "auto" }}>
              {entity.memberHosts.map((m: EnrichedHost) => (
                <span key={m.ip} className="np-pill" style={{ fontSize: "0.68rem" }}>
                  {m.hostnames[0]?.name || m.ip} • {humanBytes(m.bytes)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (entity.kind === "cityAggregate") {
    const isTombstone = Boolean(entity.tombstone?.isInactive);
    const totalBytes = entity.node?.totalBytes ?? entity.tombstone?.lastObservedBytes ?? 0;
    const totalFlows = entity.node?.totalFlows ?? entity.tombstone?.lastObservedFlows ?? 0;
    const endpointCount = entity.node?.memberCount ?? entity.memberCount ?? entity.memberHosts.length;
    const isSampled = entity.memberHosts.length < endpointCount;

    return (
      <section className="np-rail-card np-geo-context-card" aria-label="City Cluster Summary">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className={`np-badge ${isTombstone ? "np-badge--warning" : "np-badge--accent"}`}>City Aggregate</span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {entity.cityName} {entity.countryCode ? `(${entity.countryCode})` : ""} {isTombstone ? "(Inactive)" : ""}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {isTombstone && entity.tombstone && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: "var(--np-radius-sm, 6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--np-warning, #f59e0b)", fontWeight: 600, fontSize: "0.75rem" }}>
              <Icon name="alertTriangle" style={{ width: "14px", height: "14px" }} />
              <span>No longer active in live window</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--np-text-dim, #94a3b8)" }}>
              Historical snapshot retained. Observed {humanBytes(entity.tombstone.lastObservedBytes)} across {entity.tombstone.lastObservedFlows} flows before becoming inactive.
            </p>
          </div>
        )}

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Endpoints</span>
            <span className="np-rail-list__val">{endpointCount} hosts</span>
          </li>
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
          </li>
          <li>
            <span>Total Flows</span>
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
        </ul>

        {entity.memberHosts.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)", display: "block" }}>
                {isSampled
                  ? `SAMPLE ENDPOINTS (${entity.memberHosts.length} OF ${endpointCount}):`
                  : `CLUSTER ENDPOINTS (${entity.memberHosts.length}):`}
              </span>
              {isSampled && (
                <span style={{ fontSize: "0.65rem", color: "var(--np-accent, #2fe0d6)" }}>
                  Showing a sample of {entity.memberHosts.length} endpoints
                </span>
              )}
            </div>
            {isSampled && (
              <p style={{ margin: "0 0 6px", fontSize: "0.7rem", color: "var(--np-text-dim, #94a3b8)" }}>
                Displaying a representative sample of {entity.memberHosts.length} out of {endpointCount} total endpoints.
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "120px", overflowY: "auto" }}>
              {entity.memberHosts.map((m: EnrichedHost) => (
                <span key={m.ip} className="np-pill" style={{ fontSize: "0.68rem" }}>
                  {m.hostnames[0]?.name || m.ip} • {humanBytes(m.bytes)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (entity.kind === "unresolvedGroup") {
    const isIpv6Deferred = (h: EnrichedHost) => h.geo.status === "unresolved" && h.geo.reason === "ipv6_deferred";
    const ipv6DeferredCount = entity.memberHosts.filter(isIpv6Deferred).length;
    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Unresolved Public Destinations">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="np-badge np-badge--neutral">Unresolved Geography</span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {entity.title}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", marginTop: "4px" }}>
          Observed public destinations without coordinate matches in the local offline GeoIP database.
          {ipv6DeferredCount > 0
            ? ` Includes ${ipv6DeferredCount} public IPv6 endpoint${ipv6DeferredCount > 1 ? "s" : ""} where GeoIP resolution is intentionally deferred.`
            : " Physical locations are omitted to maintain accuracy."}
        </p>

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Unresolved Endpoints</span>
            <span className="np-rail-list__val">{entity.memberHosts.length} hosts</span>
          </li>
          {ipv6DeferredCount > 0 && (
            <li>
              <span>IPv6 Deferred</span>
              <span className="np-rail-list__val">{ipv6DeferredCount} hosts</span>
            </li>
          )}
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">
              {humanBytes(entity.memberHosts.reduce((s: number, h: EnrichedHost) => s + h.bytes, 0))}
            </span>
          </li>
        </ul>

        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
            {entity.memberHosts.map((m: EnrichedHost) => {
              const isDeferred = isIpv6Deferred(m);
              return (
                <div key={m.ip} className="np-pill" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
                  <span>{m.hostnames[0]?.name || m.ip}</span>
                  <span style={{ color: isDeferred ? "var(--np-text-dim)" : undefined }}>
                    {isDeferred ? "IPv6 deferred • " : ""}{humanBytes(m.bytes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  if (entity.kind === "otherResolvedAggregate") {
    return (
      <OtherResolvedCard
        entity={entity}
        onClearSelection={onClearSelection}
        onSelectEntity={onSelectEntity}
      />
    );
  }

  if (entity.kind === "localNetworkGroup") {
    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Local Network Group">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="np-badge np-badge--accent">
              {entity.category === "lan" ? "Local Network (LAN)" : "Shared / Special"}
            </span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              {entity.title}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", marginTop: "4px" }}>
          {entity.category === "lan"
            ? "Private, link-local, loopback, and multicast traffic contained within the local broadcast domain."
            : "CGNAT (RFC 6598), documentation, benchmarking, or special-use address space."}
        </p>

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Active Endpoints</span>
            <span className="np-rail-list__val">{entity.memberHosts.length} hosts</span>
          </li>
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">
              {humanBytes(entity.memberHosts.reduce((s: number, h: EnrichedHost) => s + h.bytes, 0))}
            </span>
          </li>
        </ul>

        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
            {entity.memberHosts.map((m: EnrichedHost) => (
              <div key={m.ip} className="np-pill" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
                <span>{m.ip} ({m.classification.categoryLabel})</span>
                <span>{humanBytes(m.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (entity.kind === "asn") {
    const isTombstone = Boolean(entity.tombstone?.isInactive);
    const totalBytes =
      entity.tombstone?.lastObservedBytes ??
      entity.memberHosts.reduce((s, h) => s + h.bytes, 0);
    const totalFlows =
      entity.tombstone?.lastObservedFlows ??
      entity.memberHosts.reduce((s, h) => s + h.flows, 0);
    const endpointCount = entity.memberHosts.length;

    return (
      <section className="np-rail-card np-geo-context-card" aria-label="Autonomous System (ASN) Summary">
        <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className={`np-badge ${isTombstone ? "np-badge--warning" : "np-badge--accent"}`}>
              Autonomous System (ASN)
            </span>
            <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
              AS{entity.asn} ({entity.asOrg}) {isTombstone ? "(Inactive)" : ""}
            </h2>
          </div>
          {onClearSelection && (
            <button
              type="button"
              className="np-iconbtn"
              onClick={onClearSelection}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        {isTombstone && entity.tombstone && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              borderRadius: "var(--np-radius-sm, 6px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--np-warning, #f59e0b)", fontWeight: 600, fontSize: "0.75rem" }}>
              <Icon name="alertTriangle" style={{ width: "14px", height: "14px" }} />
              <span>No longer active in live window</span>
            </div>
            <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "var(--np-text-dim, #94a3b8)" }}>
              Historical snapshot retained. Observed {humanBytes(entity.tombstone.lastObservedBytes)} across {entity.tombstone.lastObservedFlows} flows before becoming inactive.
            </p>
          </div>
        )}

        <p style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", marginTop: "4px" }}>
          Traffic routed through Autonomous System AS{entity.asn} ({entity.asOrg}).
        </p>

        <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
          <li>
            <span>Active Endpoints</span>
            <span className="np-rail-list__val">{endpointCount} hosts</span>
          </li>
          <li>
            <span>Total Volume</span>
            <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
          </li>
          <li>
            <span>Total Flows</span>
            <span className="np-rail-list__val">{totalFlows}</span>
          </li>
        </ul>

        {entity.memberHosts.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)", display: "block", marginBottom: "4px" }}>
              ROUTED ENDPOINTS ({entity.memberHosts.length}):
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
              {entity.memberHosts.map((m: EnrichedHost) => (
                <button
                  key={m.ip}
                  type="button"
                  className="np-pill"
                  onClick={() => {
                    const selected: SelectedEntity = {
                      kind: "endpoint",
                      entityId: makeHostEntityId(m.ip),
                      ip: m.ip,
                      host: m,
                    };
                    onSelectEntity?.(selected);
                    sidebar?.setSelectedEntity(selected);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    cursor: "pointer",
                    textAlign: "left",
                    background: "var(--np-surface-2, #131d2e)",
                    border: "1px solid var(--np-accent-line, rgba(47, 224, 214, 0.15))",
                  }}
                  title={`Select ${m.ip}`}
                >
                  <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.hostnames[0]?.name || m.ip}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "var(--np-accent)", marginLeft: "6px", flexShrink: 0 }}>
                    {humanBytes(m.bytes)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  return null;
});

interface OtherResolvedCardProps {
  entity: Extract<SelectedEntity, { kind: "otherResolvedAggregate" }>;
  onClearSelection?: () => void;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
}

function OtherResolvedCard({
  entity,
  onClearSelection,
  onSelectEntity,
}: OtherResolvedCardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const sidebar = useOptionalSidebar();

  const handleSelectEndpoint = (m: EnrichedHost) => {
    onSelectEntity?.({ kind: "endpoint", entityId: makeHostEntityId(m.ip), ip: m.ip, host: m });
    sidebar?.setSelectedEntity({ kind: "endpoint", entityId: makeHostEntityId(m.ip), ip: m.ip, host: m });
  };

  const totalBytes =
    entity.node?.totalBytes ?? entity.memberHosts.reduce((s, h) => s + h.bytes, 0);
  const totalFlows =
    entity.node?.totalFlows ?? entity.memberHosts.reduce((s, h) => s + h.flows, 0);

  const asns =
    entity.node?.asns ??
    Array.from(
      new Set(
        entity.memberHosts
          .map((h) => (h.asn.status === "resolved" ? h.asn.asn : null))
          .filter((a): a is number => a !== null)
      )
    );

  const normalizedSearch = searchTerm.trim().toLowerCase();

  // Full-set search over all canonical member hosts before windowed rendering
  const filteredMembers = useMemo(() => {
    if (!normalizedSearch) return entity.memberHosts;
    return entity.memberHosts.filter((m) => {
      if (m.ip.toLowerCase().includes(normalizedSearch)) return true;
      if (m.hostnames.some((h) => h.name.toLowerCase().includes(normalizedSearch))) return true;
      if (m.geo.status === "resolved") {
        if (m.geo.city && m.geo.city.toLowerCase().includes(normalizedSearch)) return true;
        if (m.geo.country && m.geo.country.toLowerCase().includes(normalizedSearch)) return true;
        if (m.geo.countryCode && m.geo.countryCode.toLowerCase().includes(normalizedSearch)) return true;
      }
      if (m.asn.status === "resolved" && m.asn.asOrg.toLowerCase().includes(normalizedSearch)) return true;
      return false;
    });
  }, [entity.memberHosts, normalizedSearch]);

  // Deterministic sorting: totalBytes DESC, then IP ASC
  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.ip.localeCompare(b.ip);
    });
  }, [filteredMembers]);

  // Windowed display (first 100 items) to prevent DOM strain
  const displayedMembers = sortedMembers.slice(0, 100);

  const totalMemberCount =
    entity.node?.memberCount ?? entity.memberCount ?? entity.memberHosts.length;
  const isSampled = entity.memberHosts.length < totalMemberCount;

  return (
    <section className="np-rail-card np-geo-context-card" aria-label="Other Resolved Traffic Summary">
      <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="np-badge np-badge--accent">Aggregate Traffic</span>
          <h2 className="np-rail-card__title" style={{ marginTop: "4px" }}>
            {entity.title}
          </h2>
        </div>
        {onClearSelection && (
          <button
            type="button"
            className="np-iconbtn"
            onClick={onClearSelection}
            aria-label="Clear selection"
            title="Clear selection"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      <p style={{ fontSize: "0.75rem", color: "var(--np-text-dim)", marginTop: "4px" }}>
        Resolved destinations aggregated to respect the rendering budget while preserving 100% of telemetry volume.
      </p>

      <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
        <li>
          <span>Aggregated Endpoints</span>
          <span className="np-rail-list__val">{totalMemberCount} hosts</span>
        </li>
        <li>
          <span>Total Volume</span>
          <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
        </li>
        <li>
          <span>Total Flows</span>
          <span className="np-rail-list__val">{totalFlows}</span>
        </li>
        <li>
          <span>Autonomous Systems</span>
          <span className="np-rail-list__val">
            {asns.length > 0 ? `${asns.length} ASNs` : "None"}
          </span>
        </li>
      </ul>

      <div style={{ marginTop: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)" }}>
            {isSampled
              ? `SAMPLE ENDPOINTS (${sortedMembers.length} OF ${totalMemberCount}):`
              : `MEMBER ENDPOINTS (${sortedMembers.length}${sortedMembers.length !== entity.memberHosts.length ? ` of ${entity.memberHosts.length}` : ""}):`}
          </span>
          {isSampled ? (
            <span style={{ fontSize: "0.65rem", color: "var(--np-accent)" }}>
              Showing a sample of {sortedMembers.length} endpoints
            </span>
          ) : sortedMembers.length > 100 ? (
            <span style={{ fontSize: "0.65rem", color: "var(--np-accent)" }}>
              Showing top 100
            </span>
          ) : null}
        </div>
        {isSampled && (
          <p style={{ margin: "0 0 6px", fontSize: "0.7rem", color: "var(--np-text-dim, #94a3b8)" }}>
            Displaying a representative sample of {entity.memberHosts.length} out of {totalMemberCount} total endpoints.
          </p>
        )}

        <input
          type="search"
          className="np-input"
          placeholder="Filter by IP, host, or ASN..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Filter aggregate member endpoints"
          style={{ width: "100%", marginBottom: "6px", fontSize: "0.72rem", padding: "4px 8px" }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "180px", overflowY: "auto" }}>
          {displayedMembers.map((m) => (
            <button
              key={m.ip}
              type="button"
              className="np-pill"
              onClick={() => handleSelectEndpoint(m)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                cursor: "pointer",
                textAlign: "left",
                background: "var(--np-surface-2, #131d2e)",
                border: "1px solid var(--np-accent-line, rgba(47, 224, 214, 0.15))",
              }}
              title={`Select ${m.ip}`}
            >
              <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.hostnames[0]?.name || m.ip}
              </span>
              <span style={{ fontSize: "0.68rem", color: "var(--np-accent)", marginLeft: "6px", flexShrink: 0 }}>
                {humanBytes(m.bytes)}
              </span>
            </button>
          ))}
          {displayedMembers.length === 0 && (
            <div style={{ fontSize: "0.72rem", color: "var(--np-text-mute)", textAlign: "center", padding: "8px" }}>
              No endpoints matching &quot;{searchTerm}&quot;
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

