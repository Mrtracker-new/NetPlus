import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_VERSION } from "@netpulse/contract";
import { query } from "../../ipc";

export function CapabilityCard() {
  const { t } = useTranslation("common");
  const [handshake, setHandshake] = useState<{
    apiVersion: number;
    hostVersion: number;
    compatible: boolean;
  }>({
    apiVersion: API_VERSION,
    hostVersion: API_VERSION,
    compatible: true,
  });

  const [capabilities, setCapabilities] = useState<string[]>([
    "Live Capture",
    "Flow Attribution",
    "TLS Dissection",
    "Security Engine",
    "Replay Engine",
  ]);

  useEffect(() => {
    let cancelled = false;

    query({ kind: "handshake", client_version: API_VERSION })
      .then((res) => {
        if (!cancelled && res.kind === "handshake") {
          setHandshake({
            apiVersion: API_VERSION,
            hostVersion: res.handshake.host_version,
            compatible: res.handshake.compatible,
          });
        }
      })
      .catch(() => {
        /* Keep fallback version info in preview mode */
      });

    query({ kind: "getCapabilityRegistry" })
      .then((res) => {
        if (!cancelled && res.kind === "capabilityRegistry" && res.registry) {
          const list = Array.isArray(res.registry.capabilities)
            ? res.registry.capabilities
            : Array.isArray(res.registry)
            ? res.registry
            : capabilities;
          setCapabilities(list);
        }
      })
      .catch(() => {
        /* Keep fallback capabilities in preview mode */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="np-rail-card np-capability-card">
      <h2 className="np-rail-card__title">{t("rail.capability_registry")}</h2>
      <ul className="np-rail-list" style={{ marginBottom: "0.5rem" }}>
        <li>
          API Version
          <span className="np-rail-list__val">v{handshake.apiVersion}</span>
        </li>
        <li>
          Engine Version
          <span className="np-rail-list__val">v{handshake.hostVersion}</span>
        </li>
        <li>
          Status
          <span
            className="np-rail-list__val"
            style={{
              color: handshake.compatible ? "#10b981" : "#ef4444",
              fontWeight: 500,
            }}
          >
            {handshake.compatible ? "Compatible" : "Incompatible"}
          </span>
        </li>
      </ul>
      <div
        className="np-rail-card__title"
        style={{ fontSize: "0.75rem", marginBottom: "0.4rem", textTransform: "uppercase" }}
      >
        Capabilities ({capabilities.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {capabilities.map((cap, i) => (
          <span
            key={i}
            className="np-evidence np-evidence--static"
            style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
          >
            {cap}
          </span>
        ))}
      </div>
    </section>
  );
}
