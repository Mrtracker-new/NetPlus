import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "../utils/cn";

export type CardElement = "article" | "section" | "div";

export interface CardProps extends ComponentPropsWithoutRef<"article"> {
  children?: ReactNode;
  className?: string;
  compact?: boolean;
  as?: CardElement;
}

export const Card = memo(
  forwardRef<HTMLElement, CardProps>(function Card(
    { children, className, compact, as: Component = "article", ...props },
    ref
  ) {
    const Tag = Component as ElementType;
    return (
      <Tag
        ref={ref}
        className={cn("np-card", compact && "np-card--compact", className)}
        {...props}
      >
        {children}
      </Tag>
    );
  })
);

Card.displayName = "Card";
