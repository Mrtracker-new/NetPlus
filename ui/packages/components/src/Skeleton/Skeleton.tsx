import { forwardRef, memo } from "react";
import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "../utils/cn";

export type SkeletonVariant = "text" | "circular" | "rectangular" | "rounded";

export interface SkeletonProps extends ComponentPropsWithoutRef<"div"> {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  as?: ElementType;
  animate?: boolean;
}

export const Skeleton = memo(
  forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
    {
      variant = "rounded",
      width,
      height,
      as: Component = "div",
      animate = true,
      className,
      style,
      ...props
    },
    ref
  ) {
    const Tag = Component as ElementType;

    const formattedWidth = typeof width === "number" ? `${width}px` : width;
    const formattedHeight =
      typeof height === "number"
        ? `${height}px`
        : height ?? (variant === "text" ? "1em" : variant === "circular" && formattedWidth ? formattedWidth : undefined);

    return (
      <Tag
        ref={ref}
        className={cn(
          "np-skeleton",
          `np-skeleton--${variant}`,
          animate && "np-skeleton--animated",
          className
        )}
        style={{
          width: formattedWidth,
          height: formattedHeight,
          ...style,
        }}
        aria-hidden="true"
        {...props}
      />
    );
  })
);

Skeleton.displayName = "Skeleton";
