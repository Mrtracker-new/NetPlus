import { useState } from "react";
import { query } from "../ipc";

export function ProtocolSandboxScreen() {
  const [layers, setLayers] = useState<string[]>(["Ethernet", "IPv4", "TCP", "HTTP/1.1"]);
  const [inspection, setInspection] = useState<any>(null);

  const inspectPacket = async () => {
    try {
      const res = await query({ kind: "buildAndDecodePacket", layers });
      if (res.kind === "decodedPacketInspection") setInspection(res.inspection);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: "24px", color: "#e2e8f0" }}>
      <h2 style={{ color: "#2fe0d6" }}>Protocol Sandbox & Interactive Packet Builder</h2>
      <p style={{ color: "#94a3b8" }}>
        Safe offline packet construction & RFC diagnostic field validation (Observe-Only; Zero Transmit path).
      </p>

      <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
        <button onClick={inspectPacket} style={{ padding: "8px 16px", background: "#2fe0d6", color: "#0b0e14", fontWeight: "bold", borderRadius: "6px", border: "none" }}>
          Build & Inspect Packet
        </button>
        <button onClick={() => setLayers(["Ethernet", "IPv4", "TCP", "HTTP/1.1"])} style={{ padding: "8px 12px", background: "#1a2130", color: "#fff", borderRadius: "6px", border: "1px solid #334155" }}>
          HTTP/1.1 Stack
        </button>
        <button onClick={() => setLayers(["Ethernet", "IPv6", "UDP", "QUIC", "HTTP/3"])} style={{ padding: "8px 12px", background: "#1a2130", color: "#fff", borderRadius: "6px", border: "1px solid #334155" }}>
          HTTP/3 Stack
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b" }}>
          <h3>Layer Tree</h3>
          <ul>
            {layers.map((l, i) => (
              <li key={i} style={{ padding: "4px 0", color: "#6366f1" }}>Layer {i + 1}: {l}</li>
            ))}
          </ul>
        </div>

        {inspection && (
          <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b" }}>
            <h3>Decoded Protocol Inspection</h3>
            <p><strong>Hex Output:</strong> <code style={{ color: "#2fe0d6" }}>{inspection.rawHex}</code></p>
            <h4>RFC Diagnostics</h4>
            {inspection.diagnostics.map((d: any, idx: number) => (
              <div key={idx} style={{ background: "#1a2130", padding: "8px", borderRadius: "4px", marginBottom: "8px" }}>
                <span style={{ color: "#f5b544" }}>[{d.severity}] {d.field} ({d.rfcReference})</span>
                <p style={{ margin: "4px 0 0 0", color: "#94a3b8" }}>{d.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
