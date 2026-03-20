import * as React from "react";

import { cn } from "@igniter/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-border-primary file:text-text-primary placeholder:text-text-tertiary selection:bg-accent selection:text-accent-text flex h-9 w-full min-w-0 rounded-md border bg-bg-input px-3 py-1 text-base text-text-primary shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-border-focus focus-visible:ring-border-focus/30 focus-visible:ring-[3px]",
        "aria-invalid:ring-warning/20 dark:aria-invalid:ring-warning/40 aria-invalid:border-warning",
        className
      )}
      {...props}
    />
  );
}

export { Input };
