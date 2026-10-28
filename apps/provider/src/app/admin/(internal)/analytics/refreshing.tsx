'use client'

import React from 'react'
import { LoaderIcon } from '@igniter/ui/assets'

/**
 * Keeps the previous content in place while a new filter loads: dimmed, not clickable, with a spinner on top, so
 * nothing jumps. `children` keep their own size.
 */
export function Refreshing({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="relative" aria-busy={active}>
      <div className={`transition-opacity duration-150 ${active ? 'opacity-40 pointer-events-none select-none' : ''}`}>
        {children}
      </div>
      {active && (
        <div className="absolute inset-0 flex items-start justify-center pt-16">
          <div className="flex items-center gap-2 rounded-md border border-border-primary bg-bg-surface px-3 py-2 text-sm text-text-secondary shadow-sm">
            <LoaderIcon className="animate-spin h-4 w-4" />
            Updating…
          </div>
        </div>
      )}
    </div>
  )
}

/** A grey block of a fixed height, for the first load. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg border border-[color:--divider] bg-[color:--main-background] ${className}`} />
}
