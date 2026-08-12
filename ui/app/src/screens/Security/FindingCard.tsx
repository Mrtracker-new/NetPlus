import { useTranslation } from "react-i18next";
import type { SecurityFinding } from "@netpulse/contract";
import { Button, EvidenceChips } from "@netpulse/components";
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

  const categoryClass = finding.category === "suspicious"
    ? "np-finding--suspicious"
    : finding.category === "anomaly"
    ? "np-finding--anomaly"
    : "np-finding--informational";

  const kindClass = finding.category === "suspicious"
    ? "np-finding__kind--suspicious"
    : finding.category === "anomaly"
    ? "np-finding__kind--anomaly"
    : "np-finding__kind--informational";

  return (
    <article
      className={`np-finding ${categoryClass} ${expected ? "np-finding--expected" : ""}`}
    >
      <header className="np-finding__head" style={{ marginBottom: "0.75rem" }}>
        <h3 className="np-finding__title" style={{ margin: 0, fontSize: "1.05rem" }}>
          {finding.title}
        </h3>
        <span className={`np-finding__kind ${kindClass}`}>
          {kindLabel}
        </span>
      </header>

      <div className="np-finding__confidence" style={{ marginBottom: "0.85rem" }}>
        <ConfidenceMeter percent={finding.confidence_percent} qualitative={finding.qualitative} />
        <span className="np-confidence-word" style={{ fontSize: "0.85rem", color: "var(--np-subtext)", textTransform: "capitalize" }}>
          {finding.qualitative} ({finding.confidence_percent}%)
        </span>
      </div>

      <p className="np-finding__explanation" style={{ fontSize: "0.92rem", marginBottom: "0.85rem" }}>
        {finding.explanation}
      </p>

      {finding.technical && shows("intermediate") && (
        <p className="np-finding__technical" style={{ marginBottom: "0.85rem" }}>
          {finding.technical}
        </p>
      )}

      {finding.corroboration && finding.corroboration.length > 0 && (
        <p className="np-finding__corroboration" style={{ marginBottom: "0.85rem" }}>
          {t("card.also_seen")}{" "}
          {finding.corroboration.map((k) => t(`kinds.${k}` as any, { defaultValue: k })).join(", ")}
        </p>
      )}

      {finding.benign_explanations && finding.benign_explanations.length > 0 && (
        <details className="np-finding__benign" style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>{t("card.normal_explanation")}</summary>
          <ul style={{ paddingLeft: "1.25rem", margin: "0.5rem 0 0 0" }}>
            {finding.benign_explanations.map((b, i) => (
              <li key={i} style={{ marginBottom: "0.25rem" }}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      <footer className="np-finding__foot">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className="np-finding__action">
            {finding.suggested_action}
          </span>
          <EvidenceChips evidence={finding.evidence} onNavigate={navigateToEvidence} />
        </div>

        <Button
          variant="standard"
          onClick={onToggleExpected}
        >
          {expected ? t("card.marked_expected") : t("card.mark_expected")}
        </Button>
      </footer>
    </article>
  );
}
