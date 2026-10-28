'use client'

import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import { LoaderIcon } from '@igniter/ui/assets'
import { notify } from '@igniter/ui/lib/sessionMessages'
import { GetAnalyticsBackfillStatus, StartAnalyticsBackfill, type AnalyticsHeader } from '@/actions/Analytics'
import { formatCount } from './format'
import { unwrap } from './unwrap'

/** Every query of the page's data: refetched when a backfill finishes. */
const ANALYTICS_DATA_QUERIES = ['analytics-options', 'analytics-header', 'analytics-summary', 'analytics-breakdown', 'analytics-sessions', 'analytics-session']

/**
 * Starts the manual backfill. Shown only while the period has (day, supplier) pairs never synced, or while a
 * backfill runs; it asks first, since it reads every missing day from the indexer. The latest run's status is
 * polled on its own (every 10 s while it runs, every minute otherwise); when it finishes, the page's data reloads
 * and the running state goes away.
 */
export default function BackfillButton({ header }: { header: AnalyticsHeader | undefined }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const status = useQuery({
    queryKey: ['analytics-backfill-status'],
    queryFn: () => unwrap(GetAnalyticsBackfillStatus()),
    refetchInterval: (query) => (query.state.data?.running ? 10_000 : 60_000),
    refetchOnWindowFocus: true,
    // After the page's own data: server actions from the browser run one at a time.
    enabled: !!header,
  })
  const running = status.data?.running ?? false

  const wasRunning = React.useRef(running)
  React.useEffect(() => {
    if (wasRunning.current && !running) {
      for (const key of ANALYTICS_DATA_QUERIES) void queryClient.invalidateQueries({ queryKey: [key] })
    }
    wasRunning.current = running
  }, [running, queryClient])

  if (running) {
    return (
      <Button variant="secondary" disabled className="gap-2">
        <LoaderIcon className="animate-spin h-4 w-4" />
        Backfill running
      </Button>
    )
  }
  if (!header || header.missing.pairs === 0) return null

  const start = async () => {
    setStarting(true)
    try {
      const result = await StartAnalyticsBackfill()
      if (!result.success) throw new Error(result.error.message)
      notify.success(result.data.started ? 'Backfill started.' : 'A backfill is already running.', { toast: true })
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['analytics-backfill-status'] })
    } catch (e) {
      notify.error('Could not start the backfill.', { toast: true, description: (e as Error).message })
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Fill missing days
      </Button>
      <ConfirmationDialog
        title="Fill missing days"
        open={open}
        onClose={() => setOpen(false)}
        footerActions={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={starting}>Cancel</Button>
            <Button onClick={start} disabled={starting} className="gap-2">
              {starting && <LoaderIcon className="animate-spin h-4 w-4" />}
              Start backfill
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3 text-sm text-text-secondary">
          <p>
            {formatCount(header.missing.days)} {header.missing.days === 1 ? 'day has' : 'days have'} no data
            for some of your suppliers ({formatCount(header.missing.pairs)} supplier-days in this period).
          </p>
          <p>
            The backfill reads every missing day of the history window for up to {formatCount(header.suppliers)} suppliers
            from the indexer, oldest first. It can take a while and adds load on the indexer. The page fills in as
            each day lands.
          </p>
        </div>
      </ConfirmationDialog>
    </>
  )
}
