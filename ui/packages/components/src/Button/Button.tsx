import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Spinner } from "../Spinner";
import { cn } from "../utils/cn";

export type ButtonVariant =
  | "standard"
  | "primary"
  | "icon"
  | "danger"
  | "ghost"
  | "secondary";

export type ButtonSize = "standard" | "sm" | "xs";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  busy?: boolean;
  children?: ReactNode;
}

export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
      variant = "standard",
      size = "standard",
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
          !isIcon && variant === "primary" && "np-btn--primary",
          !isIcon && variant === "danger" && "np-btn--danger",
          !isIcon && variant === "ghost" && "np-btn--ghost",
          !isIcon && variant === "secondary" && "np-btn--secondary",
          !isIcon && size === "sm" && "np-btn--sm",
          !isIcon && size === "xs" && "np-btn--xs",
          !isIcon && active && "np-btn--active",
          isIcon && size === "sm" && "np-iconbtn--sm",
          isIcon && size === "xs" && "np-iconbtn--xs",
          isIcon && active && "np-iconbtn--active",
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
