import { useTranslation } from "react-i18next";
import type { SecurityFinding } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { useDisclosure } from "../../modes/DisclosureContext";
import { ConfidenceMeter } from "@netpulse/viz";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";

export interface FindingCardProps {
  finding: SecurityFinding;
  expected: boolean;
  onToggleExpected: () => void;
}

export function FindingCard({ finding, expected, onToggleExpected }: FindingCardProps) {
  const { t } = useTranslation(["security"]);
  const { shows } = useDisclosure();
  const { navigateToEvidence } = useEvidenceNavigation();

  const kindKey = `kinds.${finding.kind}` as const;
  const kindLabel = t(kindKey, { defaultValue: finding.kind.replace(/_/g, " ") });

  return (
    <article
      className={expected ? "np-finding np-finding--expected" : "np-finding"}
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
        opacity: expected ? 0.7 : 1,
        transition: "opacity 0.2s ease, border-color 0.2s ease",
      }}
    >
      <header className="np-finding__head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 className="np-finding__title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          {finding.title}
        </h3>
        <span
          className="np-finding__kind"
          style={{
            fontSize: "0.78rem",
            padding: "0.2rem 0.6rem",
            borderRadius: "12px",
            background: finding.category === "suspicious" ? "rgba(239, 68, 68, 0.2)" : "rgba(59, 130, 246, 0.2)",
            color: finding.category === "suspicious" ? "#ef4444" : "#60a5fa",
            fontWeight: 600,
          }}
        >
          {kindLabel}
        </span>
      </header>

      <div className="np-finding__confidence" style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
        <ConfidenceMeter percent={finding.confidence_percent} qualitative={finding.qualitative} />
        <span className="np-confidence-word" style={{ fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", textTransform: "capitalize" }}>
          {finding.qualitative} ({finding.confidence_percent}%)
        </span>
      </div>

      <p className="np-finding__explanation" style={{ fontSize: "0.92rem", color: "var(--np-text, #e2e8f0)", lineHeight: "1.6", marginBottom: "0.85rem" }}>
        {finding.explanation}
      </p>

      {finding.technical && shows("intermediate") && (
        <p className="np-finding__technical" style={{ fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", background: "var(--np-bg, #0b1019)", padding: "0.6rem 0.85rem", borderRadius: "var(--np-radius-md, 6px)", marginBottom: "0.85rem", fontFamily: "monospace" }}>
          {finding.technical}
        </p>
      )}

      {finding.corroboration && finding.corroboration.length > 0 && (
        <p className="np-finding__corroboration" style={{ fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.85rem" }}>
          {t("card.also_seen")}{" "}
          {finding.corroboration.map((k) => t(`kinds.${k}` as any, { defaultValue: k })).join(", ")}
        </p>
      )}

      {finding.benign_explanations && finding.benign_explanations.length > 0 && (
        <details className="np-finding__benign" style={{ marginBottom: "1rem", fontSize: "0.88rem", color: "var(--np-subtext, #94a3b8)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>{t("card.normal_explanation")}</summary>
          <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem", margin: "0.5rem 0 0 0" }}>
            {finding.benign_explanations.map((b, i) => (
              <li key={i} style={{ marginBottom: "0.25rem" }}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      <footer className="np-finding__foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", paddingTop: "0.75rem", borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className="np-finding__action" style={{ fontSize: "0.85rem", color: "var(--np-accent, #2fe0d6)", fontWeight: 500 }}>
            {finding.suggested_action}
          </span>
          <EvidenceChips evidence={finding.evidence} onNavigate={navigateToEvidence} />
        </div>

        <button
          type="button"
          className="np-btn np-btn--ghost"
          style={{ fontSize: "0.82rem", padding: "0.3rem 0.65rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
          onClick={onToggleExpected}
        >
          {expected ? t("card.marked_expected") : t("card.mark_expected")}
        </button>
      </footer>
    </article>
  );
}
