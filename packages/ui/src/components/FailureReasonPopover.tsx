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
  /**
   * `error` (default) is the transaction-failure cell: red trigger, red payload
   * block. `neutral` is the same mechanics for ordinary long text — a
   * notification summary — where nothing has gone wrong.
   */
  tone?: 'error' | 'neutral'
  /** Heading on the copyable block inside the popover. */
  label?: string
}

/**
 * Truncating table cell with an expand affordance: shows a short line and, when
 * there is more to reveal (full text and/or a code), opens a popover holding the
 * complete copyable value — no navigation to a detail panel needed. Built for the
 * transaction failure-reason column (`tone="error"`, the default) and reused for
 * notification summaries (`tone="neutral"`). Generic on purpose (no
 * @igniter/commons dependency): the caller maps the short text.
 */
export function FailureReasonPopover({
  friendly,
  full,
  code,
  className,
  tone = 'error',
  label = 'Full message',
}: FailureReasonPopoverProps) {
  const expandable = Boolean(full) || code != null
  const textClass = tone === 'error' ? 'text-red-400' : 'text-text-secondary'

  // Nothing beyond the friendly text to reveal — render plain, no popover.
  if (!expandable) {
    return (
      <span className={cn('block max-w-[16rem] truncate', textClass, className)} title={friendly}>
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
          title={tone === 'error' ? 'Click to view the full error' : 'Click to view the full text'}
          className={cn(
            'flex max-w-[16rem] items-center gap-1 text-left hover:underline',
            textClass,
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
        {showHeadline && <p className={cn('text-sm', textClass)}>{friendly}</p>}
        {full ? (
          <PayloadBlock
            label={label}
            text={full}
            variant={tone === 'error' ? 'error' : 'default'}
            defaultExpanded
          />
        ) : (
          !showHeadline && <p className={cn('text-sm', textClass)}>{friendly}</p>
        )}
        {code != null && <p className="font-mono text-xs text-text-tertiary">Code: {code}</p>}
      </PopoverContent>
    </Popover>
  )
}