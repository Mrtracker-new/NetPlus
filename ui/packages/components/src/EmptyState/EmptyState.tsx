import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  compact?: boolean;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState({ children, compact, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("np-empty", compact && "np-empty--compact", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

EmptyState.displayName = "EmptyState";
