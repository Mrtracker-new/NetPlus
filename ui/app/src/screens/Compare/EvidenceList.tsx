import { useTranslation } from "react-i18next";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface EvidenceListProps {
  evidence: readonly string[];
}

export function EvidenceList({ evidence }: EvidenceListProps) {
  const { t } = useTranslation(["compare"]);
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
        {t("evidence")}
      </h3>

      {evidence.length === 0 ? (
        <p className="np-session-diff__evidence" style={{ color: "var(--np-subtext, #94a3b8)", fontSize: "0.9rem" }}>
          {t("no_evidence")}
        </p>
      ) : (
        <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {evidence.map((item, idx) => (
            <li
              key={idx}
              role="listitem"
              tabIndex={0}
              className="np-session-diff__evidence"
              onClick={() => navigateToEvidence({ kind: "session", id: idx + 1 }, "compare")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateToEvidence({ kind: "session", id: idx + 1 }, "compare");
                }
              }}
              style={{
                background: "var(--np-bg, #0b1019)",
                border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
                borderRadius: "var(--np-radius-md, 8px)",
                padding: "0.6rem 0.85rem",
                fontSize: "0.88rem",
                color: "var(--np-subtext, #94a3b8)",
                cursor: "pointer",
                transition: "border-color 0.15s ease",
              }}
            >
              🔍 {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
