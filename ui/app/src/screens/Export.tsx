// Export — sharing NetPulse's data in open, interoperable formats, always by
// explicit choice and always privacy-aware (docs/23). Because export produces data
// that can leave the machine, it carries heavy consent discipline: the user sees
// exactly what an export will contain *before* it is written (docs/23 §6), the
// default is the least-revealing form (metadata-only, sanitized, docs/23 §3), and
// export writes a file — NetPulse never auto-transmits it (docs/23 §6, docs/02 §10).

import { useEffect, useState } from "react";
import type { ExportFormat, ExportPreview, PayloadLevel } from "@netpulse/contract";
import { query, command } from "../ipc";

const FORMATS: Array<{ id: ExportFormat; label: string; blurb: string }> = [
  { id: "pcapng", label: "pcapng", blurb: "Raw frames for Wireshark/tcpdump" },
  { id: "json", label: "JSON", blurb: "Structured flows/sessions with evidence refs" },
  { id: "csv", label: "CSV", blurb: "Tabular flows/metrics for spreadsheets" },
  { id: "report", label: "Report", blurb: "A narrated, human-readable summary" },
];

export function Export() {
  const [format, setFormat] = useState<ExportFormat>("json");
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Preview the whole capture at the chosen format (docs/23 §6). Selection
    // scoping (window/session/finding) plugs in from the other surfaces (docs/23 §8).
    query({ kind: "exportPreview", selection: { kind: "all" }, format })
      .then((res) => {
        if (!cancelled) setPreview(res.kind === "exportPreview" ? res.preview : null);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [format]);

  async function doExport() {
    setNotice(null);
    const level: PayloadLevel = preview?.level ?? "metadata_only";
    try {
      await command({ kind: "startExport", selection: { kind: "all" }, format, level });
      setNotice("Export written locally. Sharing it is a separate, explicit action.");
    } catch (e) {
      setNotice(String(e));
    }
  }

  return (
    <section className="np-export" aria-label="Export">
      <div className="np-export__formats" role="radiogroup" aria-label="Export format">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={f.id === format}
            className={f.id === format ? "np-btn np-btn--active" : "np-btn"}
            onClick={() => setFormat(f.id)}
            title={f.blurb}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* The preview: exactly what the export will contain, before any byte is
          written (docs/23 §6). The preview matches the output — a tested invariant. */}
      {preview && (
        <div className="np-export__preview">
          <h3>What this export contains</h3>
          <ul>
            <li>{preview.flows} flows · {preview.sessions} sessions · {preview.hosts} hosts</li>
            <li>
              Payload level: <strong>{preview.level.replace("_", " ")}</strong>{" "}
              {preview.contains_payloads ? "(includes payloads)" : "(no payloads)"}
            </li>
            <li>{preview.provenance}</li>
          </ul>
          {preview.sanitized.length > 0 && (
            <details className="np-export__sanitized">
              <summary>Sanitization applied</summary>
              <ul>
                {preview.sanitized.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="np-export__actions">
        <button className="np-btn np-btn--primary" onClick={() => void doExport()}>
          Export to file
        </button>
        <span className="np-export__egress">
          Export writes a local file. NetPulse never uploads it — sharing is a
          separate, explicit action (docs/23 §6).
        </span>
      </div>

      {notice && <p className="np-export__notice">{notice}</p>}
    </section>
  );
}
