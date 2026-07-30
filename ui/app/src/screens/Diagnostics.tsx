import { useState } from "react";
import { query } from "../ipc";

export function DiagnosticsScreen() {
  const [target, setTarget] = useState("1.1.1.1");
  const [pingResult, setPingResult] = useState<any>(null);
  const [tracerouteHops, setTracerouteHops] = useState<any[]>([]);
  const [bufferbloat, setBufferbloat] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runPing = async () => {
    setLoading(true);
    try {
      const res = await query({ kind: "runPing", target, count: 4 });
      if (res.kind === "pingResult") setPingResult(res.result);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const runTraceroute = async () => {
    setLoading(true);
    try {
      const res = await query({ kind: "runTraceroute", target, transport: "icmp", maxHops: 10 });
      if (res.kind === "tracerouteResult") setTracerouteHops(res.hops);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const runBufferbloat = async () => {
    setLoading(true);
    try {
      const res = await query({ kind: "runBufferbloatTest", target });
      if (res.kind === "bufferbloatResult") setBufferbloat(res.result);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "24px", color: "#e2e8f0" }}>
      <h2 style={{ color: "#2fe0d6" }}>Active Network Diagnostics</h2>
      <p style={{ color: "#94a3b8" }}>
        Opt-in probes: ICMP/UDP Ping, Multi-Transport Traceroute, and Bandwidth-Constrained Bufferbloat Testing.
      </p>

      <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target Host (e.g. 1.1.1.1)"
          style={{ padding: "8px 12px", background: "#1a2130", border: "1px solid #334155", color: "#fff", borderRadius: "6px" }}
        />
        <button onClick={runPing} disabled={loading} style={{ padding: "8px 16px", background: "#2fe0d6", color: "#0b0e14", fontWeight: "bold", borderRadius: "6px", border: "none" }}>
          Ping Probe
        </button>
        <button onClick={runTraceroute} disabled={loading} style={{ padding: "8px 16px", background: "#6366f1", color: "#fff", fontWeight: "bold", borderRadius: "6px", border: "none" }}>
          Traceroute
        </button>
        <button onClick={runBufferbloat} disabled={loading} style={{ padding: "8px 16px", background: "#f5b544", color: "#0b0e14", fontWeight: "bold", borderRadius: "6px", border: "none" }}>
          Bufferbloat Test
        </button>
      </div>

      {pingResult && (
        <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", marginBottom: "16px", border: "1px solid #1e293b" }}>
          <h3>Ping Results for {pingResult.target}</h3>
          <p>Sent: {pingResult.sent} | Received: {pingResult.received} | Loss: {pingResult.lossPct}%</p>
          <p>RTT: Min {pingResult.minRttMs}ms / Avg {pingResult.avgRttMs}ms / Max {pingResult.maxRttMs}ms</p>
        </div>
      )}

      {tracerouteHops.length > 0 && (
        <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", marginBottom: "16px", border: "1px solid #1e293b" }}>
          <h3>Traceroute Hops ({tracerouteHops.length} hops)</h3>
          <table style={{ width: "100%", textAlign: "left" }}>
            <thead>
              <tr style={{ color: "#94a3b8" }}>
                <th>TTL</th>
                <th>IP</th>
                <th>Hostname</th>
                <th>RTT (ms)</th>
              </tr>
            </thead>
            <tbody>
              {tracerouteHops.map((h, i) => (
                <tr key={i}>
                  <td>{h.ttl}</td>
                  <td>{h.ip}</td>
                  <td>{h.hostname || "-"}</td>
                  <td>{h.rttMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bufferbloat && (
        <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b" }}>
          <h3>Bufferbloat Scorecard</h3>
          <p>Grade: <strong style={{ color: "#2fe0d6", fontSize: "1.5rem" }}>{bufferbloat.grade}</strong></p>
          <p>Idle RTT: {bufferbloat.idleRttMs}ms | Loaded RTT: {bufferbloat.loadedRttMs}ms | Delta: +{bufferbloat.deltaRttMs}ms</p>
        </div>
      )}
    </div>
  );
}
