import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";


import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border",
  {
    variants: {
      variant: {
        icon: "border-none !p-0",
        default:
          "bg-pnf-blue text-white border-transparent shadow-sm hover:bg-pnf-blue-hover",
        destructive:
          "bg-transparent text-error border-error hover:bg-error-bg",
        success:
          "bg-success-bg text-success border-transparent shadow-xs hover:opacity-90",
        outline:
          "bg-transparent text-text-primary border-border-primary hover:border-text-tertiary hover:bg-bg-hover",
        secondary:
          "bg-bg-elevated text-text-primary border-border-primary shadow-xs hover:border-text-tertiary",
        secondaryBorder:
              "bg-bg-elevated text-text-primary shadow-xs hover:border-text-tertiary border border-border-primary",
        secondaryStretch: "bg-bg-elevated text-text-primary shadow-xs hover:border-text-tertiary w-full border border-border-primary",
        ghost: "bg-transparent border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
        link: "text-accent border-transparent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

interface ButtonGroupProps {
  className?: string;
  activeButton?: number;
  orientation?: "horizontal" | "vertical";
  children: React.ReactElement<ButtonProps>[];
}

const ButtonGroup = ({
  className,
  activeButton,
  orientation = "horizontal",
  children,
}: ButtonGroupProps) => {
  const totalButtons = React.Children.count(children);
  const isHorizontal = orientation === "horizontal";
  const isVertical = orientation === "vertical";

  return (
    <div
      className={cn(
        "flex",
        {
          "flex-col": isVertical,
          "w-fit": isVertical,
        },
        className
      )}
    >
      {React.Children.map(children, (child, index) => {
        const isFirst = index === 0;
        const isLast = index === totalButtons - 1;
        const isActive = activeButton === index;
        const fontWeight = "font-normal";

        return React.cloneElement(child, {
          className: cn(
            {
              "rounded-s-none": isHorizontal && !isFirst,
              "rounded-e-none": isHorizontal && !isLast,
              "border-s-0": isHorizontal && !isFirst,

              "rounded-t-none": isVertical && !isFirst,
              "rounded-b-none": isVertical && !isLast,
              "border-t-0": isVertical && !isFirst,
              "bg-bg-input": isActive,
              "text-text-secondary": !isActive,
              [fontWeight]: true,
            },
            child.props.className
          ),
          variant: "secondary",
        });
      })}
    </div>
  );
};

export { Button, ButtonGroup, buttonVariants };
