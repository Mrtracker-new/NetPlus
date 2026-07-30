import { useState } from "react";
import { query } from "../ipc";

export function SessionDiffScreen() {
  const [sessionA, setSessionA] = useState(1);
  const [sessionB, setSessionB] = useState(2);
  const [diff, setDiff] = useState<any>(null);

  const runCompare = async () => {
    try {
      const res = await query({ kind: "compareSessions", sessionIdA: sessionA, sessionIdB: sessionB });
      if (res.kind === "sessionDiff") setDiff(res.diff);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: "24px", color: "#e2e8f0" }}>
      <h2 style={{ color: "#2fe0d6" }}>Session Semantic Diff Engine</h2>
      <p style={{ color: "#94a3b8" }}>
        Side-by-side session comparison with rule-based explanations, evidence provenance, and confidence scoring.
      </p>

      <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
        <input type="number" value={sessionA} onChange={(e) => setSessionA(Number(e.target.value))} placeholder="Session A ID" style={{ padding: "8px", background: "#1a2130", border: "1px solid #334155", color: "#fff", borderRadius: "6px" }} />
        <input type="number" value={sessionB} onChange={(e) => setSessionB(Number(e.target.value))} placeholder="Session B ID" style={{ padding: "8px", background: "#1a2130", border: "1px solid #334155", color: "#fff", borderRadius: "6px" }} />
        <button onClick={runCompare} style={{ padding: "8px 16px", background: "#2fe0d6", color: "#0b0e14", fontWeight: "bold", borderRadius: "6px", border: "none" }}>
          Compare Sessions
        </button>
      </div>

      {diff && (
        <div style={{ background: "#121722", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b" }}>
          <h3>Comparison Report (Session {diff.sessionIdA} vs {diff.sessionIdB})</h3>
          <p><strong>Protocol Shift:</strong> {diff.protocolShift}</p>
          <p><strong>Handshake RTT Delta:</strong> <span style={{ color: "#3fb984" }}>{diff.rttDeltaMs} ms</span></p>

          <div style={{ background: "#1a2130", padding: "12px", borderRadius: "6px", margin: "12px 0" }}>
            <h4>Semantic Explanation <span style={{ color: "#2fe0d6" }}>(Confidence: {diff.confidence})</span></h4>
            <p>{diff.semanticExplanation}</p>
          </div>

          <h4>Evidence Provenance Trace</h4>
          <ul>
            {diff.evidence.map((e: string, idx: number) => (
              <li key={idx} style={{ color: "#94a3b8" }}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
