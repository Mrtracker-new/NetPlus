import { useEffect, useState } from "react";
import { query } from "../ipc";

export function FleetScreen() {
  const [hosts, setHosts] = useState<any[]>([]);

  useEffect(() => {
    query({ kind: "listFleetHosts" }).then((res) => {
      if (res.kind === "fleetHosts") setHosts(res.hosts);
    }).catch(console.error);
  }, []);

  return (
    <div style={{ padding: "24px", color: "#e2e8f0" }}>
      <h2 style={{ color: "#2fe0d6" }}>Fleet Multi-Host Observation</h2>
      <p style={{ color: "#94a3b8" }}>
        Local-first telemetry aggregation from user-owned capture agents over framed binary transport.
      </p>

      <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b" }}>
        <h3>Registered Fleet Nodes ({hosts.length})</h3>
        {hosts.map((h, i) => (
          <div key={i} style={{ background: "#1a2130", padding: "12px", borderRadius: "6px", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
            <div>
              <strong>{h.friendlyName || h.hostname}</strong> ({h.os} / {h.platform})
              <p style={{ margin: "4px 0 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>Agent ID: {h.hostId} | Version: {h.agentVersion}</p>
            </div>
            <div>
              <span style={{ padding: "4px 8px", background: "#3fb984", color: "#0b0e14", borderRadius: "4px", fontWeight: "bold" }}>{h.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
