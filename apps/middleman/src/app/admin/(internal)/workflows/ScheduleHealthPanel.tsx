'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@igniter/ui/components/table'
import type { ScheduleHealthRow, ScheduleHealthState } from '@igniter/temporal/workflow-view'
import { GetScheduleHealth } from '@/actions/Workflows'
import { formatDateTime } from './table/columns'

const STATE_STYLE: Record<ScheduleHealthState, string> = {
  firing: 'bg-green-500/15 text-green-400',
  paused: 'bg-neutral-500/15 text-neutral-300',
  stale: 'bg-amber-500/15 text-amber-400',
  unhealthy: 'bg-red-500/15 text-red-400',
}

export default function ScheduleHealthPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['schedule-health'],
    queryFn: async () => {
      const result = await GetScheduleHealth()
      if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to load schedule health')
      return result.data
    },
    refetchInterval: 30000,
    initialData: [] as ScheduleHealthRow[],
  })

  return (
    <div className="mb-6 rounded-xl border border-border-primary p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Schedule Health
        </h2>
        <span className="text-xs text-text-tertiary">
          Read-only · surfaces what the watchdog flagged
        </span>
      </div>
      {isError ? (
        <p className="text-sm text-red-400">Unable to load schedule health.</p>
      ) : isLoading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-text-tertiary">No schedules found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Schedule</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Last Fire</TableHead>
              <TableHead>Next Fire</TableHead>
              <TableHead className="text-center">Heal Attempts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.scheduleId}>
                <TableCell className="font-mono text-xs">{row.scheduleId}</TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLE[row.state]}`}
                    title={row.note ?? undefined}
                  >
                    {row.state}
                  </span>
                </TableCell>
                <TableCell className="text-text-secondary">
                  {row.lastFire ? formatDateTime(row.lastFire) : '—'}
                </TableCell>
                <TableCell className="text-text-secondary">
                  {row.nextFire ? formatDateTime(row.nextFire) : '—'}
                </TableCell>
                <TableCell className="text-center font-mono">{row.attempts}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
