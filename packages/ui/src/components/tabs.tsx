'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@igniter/ui/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1 rounded-lg border border-border-primary p-0.5',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors',
      'hover:text-text-primary disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-bg-elevated data-[state=active]:text-text-primary',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

type TabsBadgeProps = {
  count: number;
  max?: number;
  variant?: 'destructive' | 'warning' | 'info' | 'secondary';
  className?: string;
};

const TABS_BADGE_VARIANT: Record<NonNullable<TabsBadgeProps['variant']>, string> = {
  destructive: 'bg-red-500/20 text-red-400',
  warning: 'bg-amber-500/20 text-amber-400',
  info: 'bg-blue-500/20 text-blue-400',
  secondary: 'bg-bg-elevated text-text-secondary',
};

/** Notification count badge for TabsTrigger. Hidden when count <= 0; caps at `max` (default 99) as "99+". */
function TabsBadge({ count, max = 99, variant = 'secondary', className }: TabsBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'rounded-full px-1.5 text-xs font-semibold tabular-nums',
        TABS_BADGE_VARIANT[variant],
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsBadge };
