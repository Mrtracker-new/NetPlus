import type { Diagnosis, EvidenceRef } from "@netpulse/contract";
import { EvidenceChips } from "@netpulse/components";
import { ConfidenceMeter } from "@netpulse/viz";

export interface DiagnosisCardProps {
  diagnosis: Diagnosis;
  onNavigateEvidence: (ref: EvidenceRef) => void;
}

export function DiagnosisCard({ diagnosis, onNavigateEvidence }: DiagnosisCardProps) {
  const confidenceWord = (diagnosis as { confidence_word?: string }).confidence_word;

  return (
    <article className="np-diagnosis">
      <p>{diagnosis.explanation}</p>
      {/* Confidence is always shown — honest over reassuring (docs/11 §6.3). */}
      <ConfidenceMeter
        percent={diagnosis.confidence_percent}
        qualitative={confidenceWord}
      />
      <EvidenceChips evidence={diagnosis.evidence} onNavigate={onNavigateEvidence} />
    </article>
  );
}
