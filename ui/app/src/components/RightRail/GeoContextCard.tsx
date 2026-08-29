import { useState, useMemo, memo } from "react";
import {
  type SelectedEntity,
  type EnrichedHost,
  type CloudRegionResolution,
  type ObservedPoPResolution,
  makeHostEntityId,
  makeAsnEntityId,
  humanBytes,
} from "@netpulse/viz";
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
                  {h.geo.resolutionLevel === "cloud_region"
                    ? `${(h.geo as CloudRegionResolution).regionName || "Cloud Region"} (${(h.geo as CloudRegionResolution).cloudRegion})`
                    : h.geo.resolutionLevel === "observed_pop"
                    ? `${(h.geo as ObservedPoPResolution).popName || h.geo.city} [${(h.geo as ObservedPoPResolution).popCode || "POP"}]`
                    : h.geo.city ? `${h.geo.city}, ${h.geo.countryCode}` : h.geo.country}
                </span>
              </li>
              {h.geo.latitude !== undefined && h.geo.longitude !== undefined && (
                <li>
                  <span>Coordinates</span>
                  <span className="np-rail-list__val">
                    {h.geo.latitude.toFixed(2)}°, {h.geo.longitude.toFixed(2)}°
                    {h.geography?.coordinates?.scope ? ` (${h.geography.coordinates.scope} scope)` : ""}
                  </span>
                </li>
              )}
              <li>
                <span>Geographic Precision</span>
                <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent-strong)" }}>
                  {h.geo.precisionDescription}
                </span>
              </li>
              {h.identityPrecision && (
                <li>
                  <span>Identity Precision</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent)" }}>
                    {h.identityPrecision.toUpperCase()}
                  </span>
                </li>
              )}
              {h.infrastructure?.type && (
                <li>
                  <span>Infrastructure</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-text-dim)" }}>
                    {h.infrastructure.type.toUpperCase()}{h.infrastructure.provider ? ` (${h.infrastructure.provider})` : ""}
                  </span>
                </li>
              )}
              {h.geo.resolutionLevel === "cloud_region" && (
                <li>
                  <span>Cloud Anchor</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent)" }}>
                    {(h.geo as CloudRegionResolution).provider} ({(h.geo as CloudRegionResolution).cloudRegion})
                  </span>
                </li>
              )}
              {h.geo.resolutionLevel === "observed_pop" && (
                <li>
                  <span>Observed PoP</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent)" }}>
                    {(h.geo as ObservedPoPResolution).popCode} - {(h.geo as ObservedPoPResolution).popName}
                  </span>
                </li>
              )}
              {h.geo.provenance && (
                <li>
                  <span>Provenance</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-text-dim)" }}>
                    {h.geo.provenance.source}
                  </span>
                </li>
              )}
              {h.geo.distribution === "anycast" && h.geo.resolutionLevel !== "observed_pop" && (
                <li>
                  <span>Routing Type</span>
                  <span
                    className="np-rail-list__val"
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--np-accent)",
                    }}
                  >
                    Anycast PoP ({h.anycast.provider || h.geo.organization || "Distributed"})
                  </span>
                </li>
              )}
            </>
          )}
          {h?.geo.status === "unresolved" && (
            <>
              {h.geo.country && (
                <li>
                  <span>Location</span>
                  <span className="np-rail-list__val">
                    {h.geo.country} ({h.geo.countryCode})
                  </span>
                </li>
              )}
              <li>
                <span>Geographic Precision</span>
                <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-warning, #f2b64d)" }}>
                  {h.geographicPrecision?.toUpperCase() || h.geo.precision.toUpperCase()}
                </span>
              </li>
              {h.identityPrecision && (
                <li>
                  <span>Identity Precision</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-accent)" }}>
                    {h.identityPrecision.toUpperCase()}
                  </span>
                </li>
              )}
              {h.infrastructure?.type && (
                <li>
                  <span>Infrastructure</span>
                  <span className="np-rail-list__val" style={{ fontSize: "0.72rem", color: "var(--np-text-dim)" }}>
                    {h.infrastructure.type.toUpperCase()}{h.infrastructure.provider ? ` (${h.infrastructure.provider})` : ""}
                  </span>
                </li>
              )}
              <li>
                <span>Resolution Status</span>
                <span className="np-rail-list__val" style={{ color: "var(--np-text-mute)", fontSize: "0.72rem" }}>
                  {h.resolutionReason || h.geo.explanation || (h.geo.reason === "ipv6_deferred"
                    ? "Unresolved (IPv6 GeoIP deferred)"
                    : `Unresolved (${h.geo.reason})`)}
                </span>
              </li>
            </>
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
    return (
      <UnresolvedGroupCard
        entity={entity}
        onClearSelection={onClearSelection}
        onSelectEntity={onSelectEntity}
      />
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
      <LocalNetworkGroupCard
        entity={entity}
        onClearSelection={onClearSelection}
        onSelectEntity={onSelectEntity}
      />
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
                  className="np-geo-context-card__endpoint-item"
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
                  title={`Select ${m.ip}`}
                >
                  <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.hostnames[0]?.name || m.ip}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "var(--np-accent-strong)", marginLeft: "6px", flexShrink: 0, fontFamily: "var(--np-font-mono)" }}>
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

interface UnresolvedGroupCardProps {
  entity: Extract<SelectedEntity, { kind: "unresolvedGroup" }>;
  onClearSelection?: () => void;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
}

function UnresolvedGroupCard({
  entity,
  onClearSelection,
  onSelectEntity,
}: UnresolvedGroupCardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [precisionFilter, setPrecisionFilter] = useState<"ALL" | "COUNTRY" | "NETWORK" | "UNKNOWN">("ALL");
  const sidebar = useOptionalSidebar();

  const totalHosts = entity.memberHosts.length;
  const totalBytes = useMemo(
    () => entity.memberHosts.reduce((sum, h) => sum + h.bytes, 0),
    [entity.memberHosts]
  );

  const countryCount = useMemo(
    () => entity.memberHosts.filter((h) => h.geo.precision === "country" || h.geographicPrecision === "country").length,
    [entity.memberHosts]
  );
  const networkCount = useMemo(
    () => entity.memberHosts.filter((h) => h.geo.precision === "network" || (h.geographicPrecision === "unknown" && h.identityPrecision && h.identityPrecision !== "unknown")).length,
    [entity.memberHosts]
  );
  const unknownCount = useMemo(
    () => entity.memberHosts.filter((h) => (h.geo.precision === "unknown" || h.geographicPrecision === "unknown") && (!h.identityPrecision || h.identityPrecision === "unknown")).length,
    [entity.memberHosts]
  );
  const ipv6DeferredCount = useMemo(
    () => entity.memberHosts.filter((h) => h.geo.limitation === "ipv6_database_unavailable" || h.geo.reason === "ipv6_deferred").length,
    [entity.memberHosts]
  );

  const filteredHosts = useMemo(() => {
    return entity.memberHosts.filter((h) => {
      if (precisionFilter !== "ALL") {
        if (precisionFilter === "COUNTRY" && !(h.geo.precision === "country" || h.geographicPrecision === "country")) return false;
        if (precisionFilter === "NETWORK" && !(h.geo.precision === "network" || (h.geographicPrecision === "unknown" && h.identityPrecision && h.identityPrecision !== "unknown"))) return false;
        if (precisionFilter === "UNKNOWN" && !((h.geo.precision === "unknown" || h.geographicPrecision === "unknown") && (!h.identityPrecision || h.identityPrecision === "unknown"))) return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        const matchesIp = h.ip.toLowerCase().includes(query);
        const matchesHostname = h.hostnames.some((hn) => hn.name.toLowerCase().includes(query));
        const matchesAsn = h.asn.status === "resolved" && (
          String(h.asn.asn).includes(query) || h.asn.asOrg.toLowerCase().includes(query)
        );
        const matchesCountry = Boolean(h.geo.countryCode?.toLowerCase().includes(query) || (h.geo as any).country?.toLowerCase().includes(query) || h.geography?.country?.toLowerCase().includes(query));
        const matchesExplanation = (h.resolutionReason || h.geo.explanation || "").toLowerCase().includes(query);
        return matchesIp || matchesHostname || matchesAsn || matchesCountry || matchesExplanation;
      }
      return true;
    });
  }, [entity.memberHosts, precisionFilter, searchTerm]);

  return (
    <section className="np-rail-card np-geo-context-card" aria-label="Unresolved Public Destinations">
      <div className="np-screen-context__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="np-badge np-badge--neutral">Geographic Visibility Gap</span>
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
        Observed public destinations without coordinate matches in the local offline GeoIP database. Physical locations are omitted to maintain accuracy.
      </p>

      {/* Progressive Visibility Breakdown Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "0.5rem" }}>
        <div style={{ padding: "6px 8px", background: "var(--np-bg-subtle, rgba(255,255,255,0.03))", borderRadius: "var(--np-radius-sm, 6px)", border: "1px solid var(--np-border-subtle, rgba(255,255,255,0.06))" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--np-text-mute)" }}>GROUP PHYSICAL COORDS</div>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--np-text-dim)" }}>0 / {totalHosts} (0%)</div>
        </div>
        <div style={{ padding: "6px 8px", background: "var(--np-bg-subtle, rgba(255,255,255,0.03))", borderRadius: "var(--np-radius-sm, 6px)", border: "1px solid var(--np-border-subtle, rgba(255,255,255,0.06))" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--np-text-mute)" }}>TOTAL TRAFFIC</div>
          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{humanBytes(totalBytes)}</div>
        </div>
        <div style={{ padding: "6px 8px", background: "var(--np-bg-subtle, rgba(255,255,255,0.03))", borderRadius: "var(--np-radius-sm, 6px)", border: "1px solid var(--np-border-subtle, rgba(255,255,255,0.06))" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--np-text-mute)" }}>COUNTRY IDENTITY</div>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--np-accent, #2fe0d6)" }}>{countryCount} / {totalHosts}</div>
        </div>
        <div style={{ padding: "6px 8px", background: "var(--np-bg-subtle, rgba(255,255,255,0.03))", borderRadius: "var(--np-radius-sm, 6px)", border: "1px solid var(--np-border-subtle, rgba(255,255,255,0.06))" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--np-text-mute)" }}>NETWORK IDENTITY</div>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--np-warning, #f2b64d)" }}>{networkCount} / {totalHosts}</div>
        </div>
      </div>

      <ul className="np-rail-list" style={{ marginTop: "0.5rem" }}>
        <li>
          <span>Unresolved Endpoints</span>
          <span className="np-rail-list__val">{totalHosts} hosts</span>
        </li>
        <li>
          <span>Completely Unknown</span>
          <span className="np-rail-list__val" style={{ color: "var(--np-text-mute)" }}>{unknownCount} hosts</span>
        </li>
        {ipv6DeferredCount > 0 && (
          <li>
            <span>IPv6 Deferred</span>
            <span className="np-rail-list__val">{ipv6DeferredCount} hosts</span>
          </li>
        )}
        <li>
          <span>Total Volume</span>
          <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
        </li>
      </ul>

      {/* Search & Filter Controls */}
      <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "6px" }}>
        <input
          type="text"
          className="np-input"
          placeholder="Filter unresolved hosts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: "100%", fontSize: "0.72rem", padding: "4px 8px" }}
          aria-label="Filter unresolved hosts"
        />

        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {(["ALL", "COUNTRY", "NETWORK", "UNKNOWN"] as const).map((p) => {
            const count =
              p === "ALL"
                ? totalHosts
                : p === "COUNTRY"
                ? countryCount
                : p === "NETWORK"
                ? networkCount
                : unknownCount;
            const isSelected = precisionFilter === p;
            return (
              <button
                key={p}
                type="button"
                className={`np-pill ${isSelected ? "np-pill--active" : ""}`}
                onClick={() => setPrecisionFilter(p)}
                style={{
                  fontSize: "0.68rem",
                  cursor: "pointer",
                  background: isSelected ? "var(--np-accent, #2fe0d6)" : undefined,
                  color: isSelected ? "#000" : undefined,
                  border: "none",
                }}
              >
                {p} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtered Endpoint List */}
      <div style={{ marginTop: "0.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "240px", overflowY: "auto" }}>
          {filteredHosts.length === 0 ? (
            <div style={{ fontSize: "0.72rem", color: "var(--np-text-dim)", textAlign: "center", padding: "12px 0" }}>
              No endpoints matching filter
            </div>
          ) : (
            filteredHosts.map((m: EnrichedHost) => {
              const isDeferred = m.geo.limitation === "ipv6_database_unavailable" || m.geo.reason === "ipv6_deferred";
              return (
                <div
                  key={m.ip}
                  className="np-geo-context-card__endpoint-item"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    padding: "6px 8px",
                    background: "rgba(255, 255, 255, 0.03)",
                    borderRadius: "4px",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    cursor: onSelectEntity ? "pointer" : "default",
                  }}
                  onClick={() => {
                    const sel = {
                      kind: "endpoint" as const,
                      entityId: makeHostEntityId(m.ip),
                      ip: m.ip,
                      host: m,
                    };
                    onSelectEntity?.(sel);
                    sidebar?.setSelectedEntity(sel);
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.75rem" }}>
                      {m.hostnames[0]?.name || m.ip}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: isDeferred ? "var(--np-text-dim)" : undefined }}>
                      {humanBytes(m.bytes)}
                    </span>
                  </div>

                  {m.hostnames[0]?.name && (
                    <div style={{ fontSize: "0.68rem", color: "var(--np-text-dim)" }}>
                      {m.ip} • {m.flows} flows
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap", marginTop: "2px" }}>
                    <span
                      style={{
                        fontSize: "0.65rem",
                        padding: "1px 4px",
                        borderRadius: "3px",
                        fontWeight: 600,
                        background:
                          m.geographicPrecision === "country" || m.geo.precision === "country"
                            ? "rgba(47, 224, 214, 0.15)"
                            : (m.identityPrecision && m.identityPrecision !== "unknown") || m.geo.precision === "network"
                            ? "rgba(242, 182, 77, 0.15)"
                            : "rgba(255, 255, 255, 0.08)",
                        color:
                          m.geographicPrecision === "country" || m.geo.precision === "country"
                            ? "var(--np-accent, #2fe0d6)"
                            : (m.identityPrecision && m.identityPrecision !== "unknown") || m.geo.precision === "network"
                            ? "var(--np-warning, #f2b64d)"
                            : "var(--np-text-dim)",
                      }}
                    >
                      {m.geographicPrecision === "country" || m.geo.precision === "country"
                        ? "COUNTRY"
                        : m.identityPrecision && m.identityPrecision !== "unknown"
                        ? m.identityPrecision.toUpperCase()
                        : m.geo.precision.toUpperCase()}
                    </span>

                    {m.asn.status === "resolved" && (
                      <span style={{ fontSize: "0.68rem", color: "var(--np-text-dim)" }}>
                        AS{m.asn.asn} ({m.asn.asOrg})
                      </span>
                    )}

                    {m.geo.countryCode && (
                      <span style={{ fontSize: "0.68rem", color: "var(--np-accent)" }}>
                        {m.geo.countryCode}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: "0.65rem", color: "var(--np-text-mute)", marginTop: "1px" }}>
                    {m.geo.explanation}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

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
              className="np-geo-context-card__endpoint-item"
              onClick={() => handleSelectEndpoint(m)}
              title={`Select ${m.ip}`}
            >
              <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.hostnames[0]?.name || m.ip}
              </span>
              <span style={{ fontSize: "0.68rem", color: "var(--np-accent-strong)", marginLeft: "6px", flexShrink: 0, fontFamily: "var(--np-font-mono)" }}>
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

interface LocalNetworkGroupCardProps {
  entity: Extract<SelectedEntity, { kind: "localNetworkGroup" }>;
  onClearSelection?: () => void;
  onSelectEntity?: (entity: SelectedEntity | null) => void;
}

function LocalNetworkGroupCard({
  entity,
  onClearSelection,
  onSelectEntity,
}: LocalNetworkGroupCardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const sidebar = useOptionalSidebar();

  const handleSelectEndpoint = (m: EnrichedHost) => {
    const selected: SelectedEntity = {
      kind: "endpoint",
      entityId: makeHostEntityId(m.ip),
      ip: m.ip,
      host: m,
    };
    onSelectEntity?.(selected);
    sidebar?.setSelectedEntity(selected);
  };

  const totalBytes = entity.memberHosts.reduce((s, h) => s + h.bytes, 0);
  const totalFlows = entity.memberHosts.reduce((s, h) => s + h.flows, 0);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!normalizedSearch) return entity.memberHosts;
    return entity.memberHosts.filter((m) => {
      if (m.ip.toLowerCase().includes(normalizedSearch)) return true;
      if (m.hostnames.some((h) => h.name.toLowerCase().includes(normalizedSearch))) return true;
      if (m.classification.categoryLabel.toLowerCase().includes(normalizedSearch)) return true;
      return false;
    });
  }, [entity.memberHosts, normalizedSearch]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.ip.localeCompare(b.ip);
    });
  }, [filteredMembers]);

  return (
    <section className="np-rail-card np-geo-context-card" aria-label="Local Network Group Summary">
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
          <span className="np-rail-list__val">{humanBytes(totalBytes)}</span>
        </li>
        <li>
          <span>Total Flows</span>
          <span className="np-rail-list__val">{totalFlows}</span>
        </li>
      </ul>

      <div style={{ marginTop: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--np-text-dim)" }}>
            LOCAL ENDPOINTS ({sortedMembers.length}{sortedMembers.length !== entity.memberHosts.length ? ` of ${entity.memberHosts.length}` : ""}):
          </span>
        </div>

        <input
          type="search"
          className="np-input"
          placeholder="Filter by IP, host, or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Filter local member endpoints"
          style={{ width: "100%", marginBottom: "6px", fontSize: "0.72rem", padding: "4px 8px" }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "180px", overflowY: "auto" }}>
          {sortedMembers.map((m) => (
            <button
              key={m.ip}
              type="button"
              className="np-geo-context-card__endpoint-item"
              onClick={() => handleSelectEndpoint(m)}
              title={`Inspect ${m.ip} (${m.classification.categoryLabel})`}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: "var(--np-text)" }}>
                  {m.hostnames[0]?.name || m.ip}
                </span>
                <span style={{ fontSize: "0.65rem", color: "var(--np-text-dim)" }}>
                  {m.classification.categoryLabel}
                </span>
              </div>
              <span style={{ fontSize: "0.68rem", color: "var(--np-accent-strong)", marginLeft: "6px", flexShrink: 0, fontFamily: "var(--np-font-mono)" }}>
                {humanBytes(m.bytes)}
              </span>
            </button>
          ))}
          {sortedMembers.length === 0 && (
            <div style={{ fontSize: "0.72rem", color: "var(--np-text-mute)", textAlign: "center", padding: "8px" }}>
              No endpoints matching &quot;{searchTerm}&quot;
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

