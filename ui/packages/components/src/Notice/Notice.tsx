import { forwardRef, memo } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export type NoticeLevel = "error" | "success" | "warning";

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  message?: ReactNode;
  children?: ReactNode;
  level?: NoticeLevel;
  icon?: ReactNode;
  onDismiss?: () => void;
}

export const Notice = memo(
  forwardRef<HTMLDivElement, NoticeProps>(function Notice(
    { message, children, level = "error", icon, onDismiss, className, ...props },
    ref
  ) {
    const content = message ?? children;
    if (!content) return null;

    const isError = level === "error";

    return (
      <div
        ref={ref}
        {...props}
        className={cn("np-notice", `np-notice--${level}`, className)}
        role={isError ? "alert" : "status"}
        aria-live={isError ? "assertive" : "polite"}
        aria-atomic="true"
        data-level={level}
      >
        {icon && (
          <span className="np-notice__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="np-notice__content">{content}</div>
        {onDismiss && (
          <button
            type="button"
            className="np-notice__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss notice"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
    );
  })
);

Notice.displayName = "Notice";
