import { useState } from "react";
import type { DiagnosticSeverity, PacketInspection } from "@netpulse/contract";
import { Button, Badge, Spinner, Notice, EmptyState } from "@netpulse/components";
import { query } from "../ipc";
import { useBusy } from "../hooks/useBusy";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function normalizeSeverity(value: string): DiagnosticSeverity {
  switch (value.toLowerCase()) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

export function ProtocolSandboxScreen() {
  const [layers, setLayers] = useState<string[]>(["Ethernet", "IPv4", "TCP", "HTTP/1.1"]);
  const [inspection, setInspection] = useState<PacketInspection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inspectBusy, inspectPacket] = useBusy(async (customLayers?: string[]) => {
    setNotice(null);
    setInspection(null);
    const targetLayers = customLayers ?? layers;
    try {
      const res = await query({ kind: "buildAndDecodePacket", layers: targetLayers });
      if (res.kind === "decodedPacketInspection") {
        const raw = res.inspection;
        const normalized: PacketInspection = {
          rawHex: raw.rawHex,
          layers: raw.layers,
          diagnostics: raw.diagnostics.map((d) => ({
            ...d,
            severity: normalizeSeverity(d.severity),
          })),
        };
        setInspection(normalized);
      } else {
        setNotice("Unexpected response kind from backend.");
      }
    } catch (e) {
      setNotice(toErrorMessage(e));
    }
  });

  const selectPreset = (presetLayers: string[]) => {
    setLayers(presetLayers);
    void inspectPacket(presetLayers);
  };

  return (
    <section className="np-sandbox" aria-labelledby="protocol-sandbox-title">
      <h2 id="protocol-sandbox-title">Protocol Sandbox & Interactive Packet Builder</h2>
      <p className="np-sandbox__desc">
        Safe offline packet construction & RFC diagnostic field validation (Observe-Only; Zero Transmit path).
      </p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      <div className="np-sandbox__controls">
        <Button variant="primary" busy={inspectBusy} disabled={inspectBusy} onClick={() => void inspectPacket()}>
          Build & Inspect Packet
        </Button>
        <Button
          variant="standard"
          disabled={inspectBusy}
          onClick={() => selectPreset(["Ethernet", "IPv4", "TCP", "HTTP/1.1"])}
        >
          HTTP/1.1 Stack
        </Button>
        <Button
          variant="standard"
          disabled={inspectBusy}
          onClick={() => selectPreset(["Ethernet", "IPv6", "UDP", "QUIC", "HTTP/3"])}
        >
          HTTP/3 Stack
        </Button>
      </div>

      {inspectBusy ? (
        <div role="status" aria-live="polite">
          <Spinner label="Building & inspecting packet…" />
        </div>
      ) : inspection ? (
        <div className="np-sandbox__grid">
          <article className="np-sandbox__panel">
            <h3>Layer Tree</h3>
            <ul role="list">
              {layers.map((l, i) => (
                <li key={i} role="listitem">
                  Layer {i + 1}: <strong>{l}</strong>
                </li>
              ))}
            </ul>
          </article>

          <article className="np-sandbox__panel">
            <h3>Decoded Protocol Inspection</h3>
            <p>
              <strong>Hex Output:</strong>{" "}
              <code className="np-sandbox__hex" tabIndex={0}>
                {inspection.rawHex}
              </code>
            </p>

            <h4>RFC Diagnostics</h4>
            {inspection.diagnostics.length === 0 ? (
              <p className="np-sandbox__desc">No RFC warnings or errors detected in stack.</p>
            ) : (
              <ul role="list">
                {inspection.diagnostics.map((d, idx) => (
                  <li key={idx} className="np-sandbox__diag" role="listitem">
                    <header className="np-sandbox__diag-head">
                      <Badge variant="kind">{d.severity}</Badge>
                      <strong>{d.field}</strong> ({d.rfcReference})
                    </header>
                    <p className="np-sandbox__diag-desc">{d.explanation}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      ) : (
        <EmptyState>
          Build a custom packet or choose one of the preset protocol stacks to inspect packet layers and diagnostics.
        </EmptyState>
      )}
    </section>
  );
}
