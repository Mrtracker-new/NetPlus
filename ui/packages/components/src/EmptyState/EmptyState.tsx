import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * Custom icon or visual element.
   * If not provided, a default signal wave icon is displayed.
   * Pass `null` or `false` to suppress the visual icon.
   */
  icon?: ReactNode | null | false;
  /**
   * Prominent title / heading for the empty state.
   */
  title?: ReactNode;
  /**
   * Description explaining why the state is empty and what action to take.
   */
  description?: ReactNode;
  /**
   * Primary action button/trigger (e.g. "Start Capture", "Clear Filter").
   */
  action?: ReactNode;
  /**
   * Optional secondary action button/link.
   */
  secondaryAction?: ReactNode;
  /**
   * Compact sizing for embedded containers, sidebars, or tables.
   */
  compact?: boolean;
  /**
   * Custom child content (rendered after description or as main body).
   */
  children?: ReactNode;
}

function DefaultSignalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.93 19.07A10 10 0 0 1 12 16a10 10 0 0 1 7.07 3.07" />
      <path d="M7.76 16.24A6 6 0 0 1 12 14a6 6 0 0 1 4.24 2.24" />
      <path d="M10.59 13.41A2 2 0 0 1 12 13a2 2 0 0 1 1.41.41" />
      <circle cx="12" cy="10" r="2" />
      <path d="M12 2v3" />
    </svg>
  );
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    {
      icon,
      title,
      description,
      action,
      secondaryAction,
      compact = false,
      children,
      className,
      ...props
    },
    ref
  ) {
    const showVisual = icon !== null && icon !== false;
    const visualContent = icon || <DefaultSignalIcon />;

    return (
      <div
        ref={ref}
        className={cn("np-empty", compact && "np-empty--compact", className)}
        role="region"
        {...props}
      >
        {showVisual && (
          <div className="np-empty__visual" aria-hidden="true">
            <span className="np-empty__ring np-empty__ring--outer" />
            <span className="np-empty__ring np-empty__ring--glow" />
            <div className="np-empty__icon-disc">
              {visualContent}
            </div>
          </div>
        )}

        {title && <h3 className="np-empty__title">{title}</h3>}

        {description && <p className="np-empty__desc">{description}</p>}

        {children && <div className="np-empty__content">{children}</div>}

        {(action || secondaryAction) && (
          <div className="np-empty__actions">
            {action}
            {secondaryAction}
          </div>
        )}
      </div>
    );
  }
);

EmptyState.displayName = "EmptyState";

