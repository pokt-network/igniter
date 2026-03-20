import {Button, ButtonProps} from "@igniter/ui/components/button";
import clsx from "clsx";

export function ActionButton({children, ...props}: React.PropsWithChildren & Omit<ButtonProps, 'children'>) {
  return (
    <Button
      {...props}
      className={
        clsx(
          'w-full h-[30px] bg-bg-elevated border border-border-primary hover:bg-transparent',
          props.className,
        )
      }
    >
      {children}
    </Button>
  )
}