import { forwardRef, memo } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
  label?: string;
}

export const Spinner = memo(
  forwardRef<HTMLDivElement, SpinnerProps>(function Spinner(
    { size = "md", label = "Loading…", className, ...props },
    ref
  ) {
    return (
      <div
        ref={ref}
        {...props}
        className={cn("np-spinner", `np-spinner--${size}`, className)}
        role="status"
        aria-live="polite"
        data-size={size}
      >
        <svg className="np-spinner__ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" strokeWidth="2.5" />
        </svg>
        <span className="np-sr-only">{label}</span>
      </div>
    );
  })
);

Spinner.displayName = "Spinner";
