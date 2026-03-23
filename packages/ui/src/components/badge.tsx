import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@igniter/ui/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-info-bg text-accent",
        secondary:
          "border-transparent bg-bg-elevated text-text-secondary hover:bg-bg-hover",
        destructive:
          "border-transparent bg-error-bg text-error",
        outline: "border-border-primary text-text-primary",
        success: "border-transparent bg-success-bg text-success",
        warning: "border-transparent bg-warning-bg text-warning",
        info: "border-transparent bg-info-bg text-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
