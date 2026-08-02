import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EvidenceChips, Spinner } from "@netpulse/components";
import type { ConversationTurn } from "../../hooks/useAssistantController";
import { useEvidenceNavigation } from "../../context/EvidenceNavigationContext";
import { DisclosurePanel } from "./DisclosurePanel";

export interface ConversationTurnCardProps {
  turn: ConversationTurn;
  onRetry: () => void;
  onDelete: () => void;
}

export function ConversationTurnCard({ turn, onRetry, onDelete }: ConversationTurnCardProps) {
  const { t } = useTranslation(["assistant"]);
  const { navigateToEvidence } = useEvidenceNavigation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (turn.answer?.text) {
      navigator.clipboard.writeText(turn.answer.text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const citations = turn.answer?.citations || [];

  return (
    <article
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      {/* User Question */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-accent, #2fe0d6)" }}>
          💬 {turn.question}
        </h3>
        <button
          type="button"
          className="np-btn np-btn--ghost"
          style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", opacity: 0.7 }}
          onClick={onDelete}
          title={t("delete_turn")}
        >
          ✕
        </button>
      </div>

      {/* Assistant Status */}
      {turn.status === "pending" ? (
        <div style={{ padding: "1rem 0" }}>
          <Spinner label={t("thinking")} />
        </div>
      ) : turn.status === "error" ? (
        <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid #ef4444", borderRadius: "8px", padding: "0.75rem 1rem", color: "#fca5a5" }}>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem" }}>{turn.error || "Failed to generate answer."}</p>
          <button type="button" className="np-btn np-btn--primary" style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }} onClick={onRetry}>
            {t("retry")}
          </button>
        </div>
      ) : turn.answer ? (
        <div>
          {/* Posture & Grounded Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "0.78rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "12px",
                background: turn.answer.is_remote ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)",
                color: turn.answer.is_remote ? "#ef4444" : "#10b981",
                fontWeight: 600,
              }}
            >
              {turn.answer.is_remote ? t("posture.remote") : t("posture.local")} · {turn.answer.backend_id}
            </span>

            {turn.answer.grounded ? (
              <span style={{ fontSize: "0.78rem", color: "#60a5fa", fontWeight: 500 }}>
                {t("posture.grounded", { count: citations.length })}
              </span>
            ) : (
              <span style={{ fontSize: "0.78rem", color: "var(--np-subtext, #94a3b8)", fontStyle: "italic" }}>
                {t("posture.ungrounded")}
              </span>
            )}
          </div>

          {/* Answer Text */}
          <p className="np-assistant__text" style={{ fontSize: "0.95rem", color: "var(--np-text, #e2e8f0)", lineHeight: "1.6", margin: "0 0 1rem 0" }}>
            {turn.answer.text}
          </p>

          {/* Citation Evidence Chips & Actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", paddingTop: "0.75rem", borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))" }}>
            {citations.length > 0 ? (
              <EvidenceChips evidence={citations} onNavigate={navigateToEvidence} />
            ) : (
              <div />
            )}

            <button
              type="button"
              className="np-btn np-btn--ghost"
              style={{ fontSize: "0.8rem", padding: "0.3rem 0.65rem", border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" }}
              onClick={handleCopy}
            >
              {copied ? t("copied") : t("copy_answer")}
            </button>
          </div>

          {/* Disclosure Panel */}
          {turn.answer.disclosure && <DisclosurePanel disclosure={turn.answer.disclosure} />}
        </div>
      ) : null}
    </article>
  );
}
