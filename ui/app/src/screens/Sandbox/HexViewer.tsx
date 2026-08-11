import { useTranslation } from "react-i18next";
import { formatHexDump } from "../../hooks/useSandboxController";

export interface HexViewerProps {
  rawHex: string;
  onCopyHex: () => void;
  onCopyJson: () => void;
  toast: string | null;
}

export function HexViewer({ rawHex, onCopyHex, onCopyJson, toast }: HexViewerProps) {
  const { t } = useTranslation(["sandbox"]);
  const hexRows = formatHexDump(rawHex);
  const totalBytes = Math.floor(rawHex.length / 2);

  return (
    <article className="np-sandbox__card" aria-label={t("raw_hex")}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text)" }}>
            {t("raw_hex")}
          </h3>
          <span className="np-sandbox__badge np-sandbox__badge--good">
            {totalBytes} Bytes
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {toast && (
            <span style={{ fontSize: "0.8rem", color: "var(--np-good)", fontWeight: 600, marginRight: "0.5rem" }}>
              ✓ {t(toast as any)}
            </span>
          )}
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem", border: "1px solid var(--np-border)" }}
            onClick={onCopyHex}
            aria-label="Copy raw hex bytes to clipboard"
          >
            📋 {t("copy_hex")}
          </button>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.65rem", border: "1px solid var(--np-border)" }}
            onClick={onCopyJson}
            aria-label="Copy JSON packet structure to clipboard"
          >
            {t("copy_json")}
          </button>
        </div>
      </div>

      {/* Wireshark-Style Hex Dump Table */}
      <div className="np-sandbox__hex-box">
        <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--np-text)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--np-border)", color: "var(--np-muted)", fontSize: "0.75rem" }}>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "left" }}>Offset</th>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "left" }}>Hex Bytes</th>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "right" }}>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {hexRows.map((row, idx) => (
              <tr key={idx} style={{ lineHeight: "1.6" }}>
                <td style={{ color: "var(--np-muted)", paddingRight: "1rem", fontFamily: "monospace" }}>{row.offset}</td>
                <td style={{ color: "var(--np-accent)", paddingRight: "1rem", fontFamily: "monospace", letterSpacing: "0.05em" }}>{row.hexBytes}</td>
                <td style={{ textAlign: "right", color: "var(--np-subtext)", fontFamily: "monospace" }}>{row.ascii}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
