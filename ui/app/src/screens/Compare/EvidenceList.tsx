import { useTranslation } from "react-i18next";
import { Icon } from "../../icons";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface EvidenceListProps {
  evidence: readonly string[];
}

export function EvidenceList({ evidence }: EvidenceListProps) {
  const { t } = useTranslation(["compare"]);
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text)" }}>
        {t("evidence")}
      </h3>

      {evidence.length === 0 ? (
        <p style={{ color: "var(--np-subtext)", fontSize: "0.9rem" }}>
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
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Icon name="search" style={{ width: 14, height: 14, color: "var(--np-accent)", flexShrink: 0 }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
