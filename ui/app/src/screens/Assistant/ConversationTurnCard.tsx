import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EvidenceChips, Spinner } from "@netpulse/components";
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
    <Card className="np-assistant__turn">
      {/* User Question */}
      <div className="np-assistant__turn-header">
        <h3 className="np-assistant__question">
          💬 {turn.question}
        </h3>
        <Button
          type="button"
          variant="icon"
          onClick={onDelete}
          title={t("delete_turn")}
          aria-label={t("delete_turn")}
        >
          ✕
        </Button>
      </div>

      {/* Assistant Status */}
      {turn.status === "pending" ? (
        <div style={{ padding: "var(--np-3) 0" }}>
          <Spinner label={t("thinking")} />
        </div>
      ) : turn.status === "error" ? (
        <div className="np-assistant__error-box">
          <p style={{ margin: 0, fontSize: "var(--np-fs-base)" }}>{turn.error || "Failed to generate answer."}</p>
          <Button type="button" variant="primary" style={{ alignSelf: "flex-start" }} onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : turn.answer ? (
        <div>
          {/* Posture & Grounded Badges */}
          <div className="np-assistant__posture-row" style={{ marginBottom: "var(--np-3)" }}>
            <Badge
              variant="posture"
              className={turn.answer.is_remote ? "np-posture--remote" : "np-posture--local"}
            >
              {turn.answer.is_remote ? t("posture.remote") : t("posture.local")} · {turn.answer.backend_id}
            </Badge>

            {turn.answer.grounded ? (
              <span style={{ fontSize: "var(--np-fs-sm)", color: "var(--np-accent-strong)", fontWeight: 500 }}>
                {t("posture.grounded", { count: citations.length })}
              </span>
            ) : (
              <span style={{ fontSize: "var(--np-fs-sm)", color: "var(--np-text-mute)", fontStyle: "italic" }}>
                {t("posture.ungrounded")}
              </span>
            )}
          </div>

          {/* Answer Text */}
          <p className="np-assistant__text">
            {turn.answer.text}
          </p>

          {/* Citation Evidence Chips & Actions */}
          <div className="np-assistant__citations-row">
            {citations.length > 0 ? (
              <EvidenceChips evidence={citations} onNavigate={navigateToEvidence} />
            ) : (
              <div />
            )}

            <Button
              type="button"
              onClick={handleCopy}
            >
              {copied ? t("copied") : t("copy_answer")}
            </Button>
          </div>

          {/* Disclosure Panel */}
          {turn.answer.disclosure && <DisclosurePanel disclosure={turn.answer.disclosure} />}
        </div>
      ) : null}
    </Card>
  );
}

