'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { Badge } from '@igniter/ui/components/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@igniter/ui/components/table';
import type { ScheduleFireView, ScheduleHealthRow, ScheduleHealthState } from '@igniter/temporal/workflow-view';

import { ListWorkflows } from '@/actions/Workflows';
import { detailHref, formatDateTime, formatRelative, statusBadgeVariant } from './table/columns';

const STATE_VARIANT: Record<ScheduleHealthState, 'success' | 'secondary' | 'warning' | 'destructive'> = {
  healthy: 'success',
  paused: 'secondary',
  stale: 'warning',
  unhealthy: 'destructive',
};

const LAG_WARN_MS = 30_000;

export function SchedulesTab({ health }: { health: UseQueryResult<ScheduleHealthRow[]> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const viewRuns = (scheduleId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'workflows');
    params.set('scheduledBy', scheduleId);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  if (health.isError) {
    return (
      <p className="text-sm text-red-400">
        Failed to load schedule health.{' '}
        <button className="underline" onClick={() => health.refetch()}>Retry</button>
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-border-primary p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Schedule health</h2>
        <span className="text-xs text-text-tertiary">
          Read-only · surfaces what the watchdog flagged
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>Schedule</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Last fire</TableHead>
            <TableHead>Next fire</TableHead>
            <TableHead className="text-center">Heal attempts</TableHead>
            <TableHead>Note</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {health.data?.map((row) => (
            <React.Fragment key={row.scheduleId}>
              <TableRow>
                <TableCell className="w-8">
                  <button
                    type="button"
                    aria-label="Toggle recent fires"
                    className="text-text-secondary hover:text-text-primary"
                    onClick={() =>
                      setExpanded((e) => ({ ...e, [row.scheduleId]: !e[row.scheduleId] }))
                    }
                  >
                    {expanded[row.scheduleId] ? '▾' : '▸'}
                  </button>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.scheduleId}</TableCell>
                <TableCell>
                  <Badge variant={STATE_VARIANT[row.state]}>{row.state}</Badge>
                </TableCell>
                <TableCell title={row.lastFire ? formatDateTime(row.lastFire) : undefined}>
                  {formatRelative(row.lastFire)}
                </TableCell>
                <TableCell title={row.nextFire ? formatDateTime(row.nextFire) : undefined}>
                  {formatRelative(row.nextFire)}
                </TableCell>
                <TableCell className={`text-center font-mono ${row.attempts > 0 ? 'text-amber-400' : ''}`}>
                  {row.attempts}
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-text-secondary" title={row.note ?? undefined}>
                  {row.note ?? '-'}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                    onClick={() => viewRuns(row.scheduleId)}
                  >
                    View runs
                  </button>
                </TableCell>
              </TableRow>
              {expanded[row.scheduleId] && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="px-4 pb-4 pt-1">
                    <RecentFires scheduleId={row.scheduleId} fires={row.recentFires} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const FIRE_GRID = 'grid grid-cols-[100px_80px_minmax(0,1fr)_140px] items-center gap-x-4';

function RecentFires({ scheduleId, fires }: { scheduleId: string; fires: ScheduleFireView[] }) {
  // Lazy status lookup: one visibility query per expanded schedule, matched by workflowId.
  const runs = useQuery({
    queryKey: ['schedule-runs', scheduleId],
    queryFn: async () => {
      const result = await ListWorkflows({ scheduledBy: scheduleId }, { pageIndex: 0, pageSize: 25 });
      if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to load runs');
      return result.data.items;
    },
    staleTime: 10_000,
  });
  const statusOf = (workflowId: string) =>
    runs.data?.find((run) => run.workflowId === workflowId)?.status ?? null;

  if (fires.length === 0) {
    return <span className="text-xs text-text-tertiary">No recent fires recorded.</span>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-primary">
      <div className={`${FIRE_GRID} border-b border-border-primary bg-bg-elevated/60 px-3 py-1.5 text-xs uppercase tracking-wide text-text-tertiary`}>
        <span>Fired</span>
        <span>Lag</span>
        <span>Workflow</span>
        <span>Status</span>
      </div>
      {[...fires].reverse().map((fire) => {
        const status = statusOf(fire.workflowId);
        return (
          <div
            key={`${fire.workflowId}:${fire.takenAt}`}
            className={`${FIRE_GRID} border-b border-border-primary/50 px-3 py-2 text-xs last:border-b-0 hover:bg-bg-elevated/30`}
          >
            <span title={formatDateTime(fire.takenAt)}>{formatRelative(fire.takenAt)}</span>
            <span className={fire.lagMs > LAG_WARN_MS ? 'font-medium text-amber-400' : 'text-text-tertiary'}>
              {fire.lagMs < 1000 ? `${fire.lagMs}ms` : `${Math.round(fire.lagMs / 1000)}s`}
            </span>
            <Link
              className="truncate font-mono underline-offset-2 hover:underline"
              title={fire.workflowId}
              href={detailHref(fire.workflowId, fire.firstExecutionRunId ?? '')}
            >
              {fire.workflowId}
            </Link>
            {status ? (
              <span>
                <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
              </span>
            ) : (
              <span className="text-text-tertiary">{runs.isLoading ? '…' : '—'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
