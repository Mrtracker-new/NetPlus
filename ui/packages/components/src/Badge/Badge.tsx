import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../utils/cn";

export type BadgeVariant =
  | "evidence-count"
  | "confidence"
  | "confidence-word"
  | "posture"
  | "kind"
  | "trust"
  | "level";

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  variant: BadgeVariant;
  children?: ReactNode;
  className?: string;
}

const badgeClasses: Record<BadgeVariant, string> = {
  "evidence-count": "np-evidence-count",
  confidence: "np-confidence",
  "confidence-word": "np-confidence-word",
  posture: "np-posture",
  kind: "np-finding__kind",
  trust: "np-plugin__trust",
  level: "np-recording__level",
};

export const Badge = memo(
  forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
    { variant, children, className, ...props },
    ref
  ) {
    return (
      <span
        {...props}
        ref={ref}
        className={cn(badgeClasses[variant], className)}
      >
        {children}
      </span>
    );
  })
);

Badge.displayName = "Badge";
