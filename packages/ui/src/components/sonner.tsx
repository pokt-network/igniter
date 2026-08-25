"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Severity accent: a left rule plus a tinted icon, using the same tokens as
// `badge.tsx` and the notification bell so a "warning" looks the same wherever it
// appears. There is no `--info` foreground token, so info borrows `--accent`.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Persistent toasts (see `toast` below) need a way out that isn't a swipe.
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-bg-surface group-[.toaster]:text-text-primary group-[.toaster]:border-border-primary group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-text-secondary",
          actionButton:
            "group-[.toast]:bg-pnf-blue group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-bg-elevated group-[.toast]:text-text-secondary",
          closeButton:
            "group-[.toast]:bg-bg-elevated group-[.toast]:text-text-secondary group-[.toast]:border-border-primary",
          success:
            "group-[.toaster]:border-l-2 group-[.toaster]:border-l-success [&_[data-icon]]:text-success",
          error:
            "group-[.toaster]:border-l-2 group-[.toaster]:border-l-error [&_[data-icon]]:text-error",
          warning:
            "group-[.toaster]:border-l-2 group-[.toaster]:border-l-warning [&_[data-icon]]:text-warning",
          info:
            "group-[.toaster]:border-l-2 group-[.toaster]:border-l-accent [&_[data-icon]]:text-accent",
        },
      }}
      {...props}
    />
  );
};

// These toasts replaced sticky header banners that stayed until the user
// dismissed them, and most error text is a raw server message worth reading — so
// errors and warnings do not time out. Successes stay transient (sonner's 4s).
// A caller can still override by passing its own `duration`.
const persistUntilDismissed =
  (notify: (message: React.ReactNode, data?: ExternalToast) => string | number) =>
  (message: React.ReactNode, data?: ExternalToast) =>
    notify(message, { duration: Infinity, ...data });

// Wraps rather than mutates sonner's own `toast`, so a module that imports
// straight from "sonner" is unaffected.
const toast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    error: persistUntilDismissed(sonnerToast.error),
    warning: persistUntilDismissed(sonnerToast.warning),
  },
);

export { Toaster, toast };
