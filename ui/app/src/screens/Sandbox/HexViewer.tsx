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

  return (
    <article
      className="np-sandbox__panel"
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          {t("raw_hex")}
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {toast && (
            <span style={{ fontSize: "0.8rem", color: "var(--np-accent, #2fe0d6)", fontWeight: 600, marginRight: "0.5rem" }}>
              ✓ {t(toast as any)}
            </span>
          )}
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
            onClick={onCopyHex}
          >
            📋 {t("copy_hex")}
          </button>
          <button
            type="button"
            className="np-btn np-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
            onClick={onCopyJson}
          >
            {t("copy_json")}
          </button>
        </div>
      </div>

      {/* Wireshark-Style Hex Dump Table */}
      <div
        style={{
          background: "var(--np-bg, #0b1019)",
          padding: "0.85rem 1rem",
          borderRadius: "var(--np-radius-md, 8px)",
          fontFamily: "monospace",
          fontSize: "0.82rem",
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--np-text, #e2e8f0)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.1))", color: "var(--np-muted, #8b9bb4)", fontSize: "0.75rem" }}>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "left" }}>Offset</th>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "left" }}>Hex Bytes</th>
              <th scope="col" style={{ paddingBottom: "0.4rem", textAlign: "right" }}>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {hexRows.map((row, idx) => (
              <tr key={idx} style={{ lineHeight: "1.6" }}>
                <td style={{ color: "var(--np-muted, #8b9bb4)", paddingRight: "1rem" }}>{row.offset}</td>
                <td style={{ color: "var(--np-accent, #2fe0d6)", paddingRight: "1rem" }}>{row.hexBytes}</td>
                <td style={{ textAlign: "right", color: "var(--np-subtext, #94a3b8)" }}>{row.ascii}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
