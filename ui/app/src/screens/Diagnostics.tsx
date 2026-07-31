import { useState } from "react";
import type { PingResult, TracerouteHop, BufferbloatResult } from "@netpulse/contract";
import { Button, Input, Notice, EmptyState } from "@netpulse/components";
import { query } from "../ipc";
import { useBusy } from "../hooks/useBusy";
import { useDisclosure } from "../modes/DisclosureContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function DiagnosticsScreen() {
  const [target, setTarget] = useState("1.1.1.1");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [tracerouteHops, setTracerouteHops] = useState<TracerouteHop[]>([]);
  const [bufferbloat, setBufferbloat] = useState<BufferbloatResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { shows } = useDisclosure();

  const [pingBusy, runPing] = useBusy(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "runPing", target, count: 4 });
      if (res.kind === "pingResult") setPingResult(res.result);
    } catch (e) {
      setNotice(toErrorMessage(e));
    }
  });

  const [traceBusy, runTraceroute] = useBusy(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "runTraceroute", target, transport: "icmp", maxHops: 10 });
      if (res.kind === "tracerouteResult") setTracerouteHops(res.hops);
    } catch (e) {
      setNotice(toErrorMessage(e));
    }
  });

  const [bloatBusy, runBufferbloat] = useBusy(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "runBufferbloatTest", target });
      if (res.kind === "bufferbloatResult") setBufferbloat(res.result);
    } catch (e) {
      setNotice(toErrorMessage(e));
    }
  });

  const isBusy = pingBusy || traceBusy || bloatBusy;
  const hasResults = Boolean(pingResult || tracerouteHops.length > 0 || bufferbloat);

  return (
    <section className="np-diagnostics" aria-label="Network Diagnostics">
      <h2>Active Network Diagnostics</h2>
      <p className="np-diagnostics__desc">
        Opt-in probes: ICMP/UDP Ping, Multi-Transport Traceroute, and Bandwidth-Constrained Bufferbloat Testing.
      </p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      <div className="np-diagnostics__actions">
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target Host (e.g. 1.1.1.1)"
          aria-label="Target Host"
        />
        <Button variant="primary" busy={pingBusy} disabled={isBusy} onClick={() => void runPing()}>
          Ping Probe
        </Button>
        <Button variant="standard" busy={traceBusy} disabled={isBusy} onClick={() => void runTraceroute()}>
          Traceroute
        </Button>
        <Button variant="standard" busy={bloatBusy} disabled={isBusy} onClick={() => void runBufferbloat()}>
          Bufferbloat Test
        </Button>
      </div>

      {!hasResults && !isBusy && !notice ? (
        <EmptyState>
          Run a probe to display diagnostic results (Ping, Traceroute, or Bufferbloat).
        </EmptyState>
      ) : (
        <div aria-live="polite">
          {pingResult && (
            <div className="np-diagnostics__result">
              <h3>Ping Results for {pingResult.target}</h3>
              <p>Sent: {pingResult.sent} | Received: {pingResult.received} | Loss: {pingResult.lossPct}%</p>
              <p>RTT: Min {pingResult.minRttMs}ms / Avg {pingResult.avgRttMs}ms / Max {pingResult.maxRttMs}ms</p>
            </div>
          )}

          {tracerouteHops.length > 0 && (
            <div className="np-diagnostics__result">
              <h3>Traceroute Hops ({tracerouteHops.length} hops)</h3>
              <table className="np-breakdown">
                <thead>
                  <tr>
                    <th scope="col">TTL</th>
                    <th scope="col">IP</th>
                    <th scope="col">Hostname</th>
                    <th scope="col">RTT (ms)</th>
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
            <div className="np-diagnostics__result">
              <h3>Bufferbloat Scorecard</h3>
              <p>
                Grade: <span className="np-diagnostics__grade">{bufferbloat.grade}</span>
              </p>
              {shows("intermediate") && (
                <p>
                  Idle RTT: {bufferbloat.idleRttMs}ms | Loaded RTT: {bufferbloat.loadedRttMs}ms | Delta: +{bufferbloat.deltaRttMs}ms
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
