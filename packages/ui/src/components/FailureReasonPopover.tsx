'use client'

import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import { PayloadBlock } from '@igniter/ui/components/PayloadBlock'
import { cn } from '@igniter/ui/lib/utils'

export type FailureReasonPopoverProps = {
  /** Short, human-readable reason shown in the cell (already computed by the caller). */
  friendly: string
  /** Full raw chain error, shown expanded + copyable in the popover. '' when none. */
  full: string
  /** On-chain error code, shown in the popover footer. */
  code?: number | null
  /** Extra classes for the trigger (e.g. truncate width). */
  className?: string
}

/**
 * Failure-reason table cell: shows the short friendly reason and, when there is
 * more to show (a full raw log and/or a code), an expand affordance that opens a
 * popover with the full copyable error — no navigation to the detail panel needed.
 * Generic on purpose (no @igniter/commons dependency): the caller maps the reason.
 */
export function FailureReasonPopover({ friendly, full, code, className }: FailureReasonPopoverProps) {
  const expandable = Boolean(full) || code != null

  // Nothing beyond the friendly text to reveal — render plain, no popover.
  if (!expandable) {
    return (
      <span className={cn('block max-w-[16rem] truncate text-red-400', className)} title={friendly}>
        {friendly}
      </span>
    )
  }

  // Show the friendly headline in the popover only when it adds detail beyond the raw text.
  const showHeadline = Boolean(full) && friendly !== full

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Keep the click on the cell (don't trigger any row-level open).
          onClick={(e) => e.stopPropagation()}
          title="Click to view the full error"
          className={cn(
            'flex max-w-[16rem] items-center gap-1 text-left text-red-400 hover:underline',
            className,
          )}
        >
          <span className="truncate">{friendly}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0 opacity-70">
            <path
              fill="currentColor"
              d="M9 2h5v5h-1.5V4.56L8.56 8.5 7.5 7.44 11.44 3.5H9V2zM2 9h1.5v2.44L7.44 7.5 8.5 8.56 4.56 12.5H7V14H2V9z"
            />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[380px] max-w-[90vw] flex-col gap-2 p-3">
        {showHeadline && <p className="text-sm text-red-400">{friendly}</p>}
        {full ? (
          <PayloadBlock label="Full message" text={full} variant="error" defaultExpanded />
        ) : (
          !showHeadline && <p className="text-sm text-red-400">{friendly}</p>
        )}
        {code != null && <p className="font-mono text-xs text-text-tertiary">Code: {code}</p>}
      </PopoverContent>
    </Popover>
  )
}