import { forwardRef, memo, useCallback } from "react";
import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from "react";
import type { EvidenceRef } from "@netpulse/contract";
import { cn } from "../utils/cn";

export function formatEvidenceLabel(ref: EvidenceRef): string {
  if (!ref || typeof ref !== "object" || !("kind" in ref)) {
    return "unknown evidence";
  }
  switch (ref.kind) {
    case "flow":
      return `flow #${ref.id}`;
    case "session":
      return `session #${ref.id}`;
    case "packet":
      return `packet #${ref.id}`;
    default:
      return `${(ref as { kind: string; id?: number }).kind} #${(ref as { id?: number }).id ?? ""}`.trim();
  }
}

export interface EvidenceChipProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick"> {
  evidence: EvidenceRef;
  interactive?: boolean;
  onNavigate?: (ref: EvidenceRef) => void;
  className?: string;
  children?: ReactNode;
}

export const EvidenceChip = memo(
  forwardRef<HTMLButtonElement, EvidenceChipProps>(function EvidenceChip(
    { evidence, interactive = true, onNavigate, className, children, ...props },
    ref
  ) {
    const handleClick = useCallback(() => {
      if (interactive && onNavigate) {
        onNavigate(evidence);
      }
    }, [interactive, onNavigate, evidence]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLButtonElement>) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          if (onNavigate) {
            onNavigate(evidence);
          }
        }
      },
      [interactive, onNavigate, evidence]
    );

    const label = children ?? formatEvidenceLabel(evidence);

    if (!interactive) {
      return (
        <span
          className={cn("np-evidence", "np-evidence--static", className)}
        >
          {label}
        </span>
      );
    }

    return (
      <button
        {...props}
        ref={ref}
        type="button"
        tabIndex={0}
        className={cn("np-evidence", className)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        title={`Navigate to ${formatEvidenceLabel(evidence)}`}
        aria-label={`Evidence: ${formatEvidenceLabel(evidence)}`}
      >
        {label}
      </button>
    );
  })
);

EvidenceChip.displayName = "EvidenceChip";

export interface EvidenceChipsProps {
  evidence: EvidenceRef[];
  interactive?: boolean;
  onNavigate?: (ref: EvidenceRef) => void;
  className?: string;
}

export const EvidenceChips = memo(function EvidenceChips({
  evidence,
  interactive = true,
  onNavigate,
  className,
}: EvidenceChipsProps) {
  if (!evidence || evidence.length === 0) {
    return null;
  }

  return (
    <div className={cn("np-evidence-chips", className)}>
      {evidence.map((ref, idx) => (
        <EvidenceChip
          key={`${ref.kind}-${ref.id ?? idx}`}
          evidence={ref}
          interactive={interactive}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
});

EvidenceChips.displayName = "EvidenceChips";
