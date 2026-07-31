import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export type InputVariant = "standard" | "search";

export interface InputProps extends ComponentPropsWithoutRef<"input"> {
  variant?: InputVariant;
  invalid?: boolean;
}

export const Input = memo(
  forwardRef<HTMLInputElement, InputProps>(function Input(
    { variant = "standard", invalid, className, type, ...rest },
    ref
  ) {
    const isSearch = variant === "search";
    const baseClass = isSearch ? "np-explorer__search" : "np-input";
    const inputType = type ?? (isSearch ? "search" : "text");

    return (
      <input
        {...rest}
        ref={ref}
        type={inputType}
        aria-invalid={invalid || undefined}
        className={cn(baseClass, className)}
      />
    );
  })
);

Input.displayName = "Input";
