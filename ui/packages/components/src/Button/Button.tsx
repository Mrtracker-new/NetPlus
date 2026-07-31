import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Spinner } from "../Spinner";
import { cn } from "../utils/cn";

export type ButtonVariant = "standard" | "primary" | "icon" | "danger";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  active?: boolean;
  busy?: boolean;
  children?: ReactNode;
}

export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
      variant = "standard",
      active,
      busy,
      disabled,
      children,
      className,
      type = "button",
      ...rest
    },
    ref
  ) {
    const isIcon = variant === "icon";
    const baseClass = isIcon ? "np-iconbtn" : "np-btn";
    const isDisabled = disabled || busy;

    return (
      <button
        {...rest}
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={busy || undefined}
        className={cn(
          baseClass,
          variant === "primary" && "np-btn--primary",
          variant === "danger" && "np-btn--danger",
          active && "np-btn--active",
          className
        )}
      >
        {busy && <Spinner size="sm" label="Loading…" />}
        {children && <span>{children}</span>}
      </button>
    );
  })
);

Button.displayName = "Button";
