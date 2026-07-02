'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { UseQueryResult } from '@tanstack/react-query';

import { Badge } from '@igniter/ui/components/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@igniter/ui/components/table';
import type { ScheduleHealthRow, ScheduleHealthState } from '@igniter/temporal/workflow-view';

import { detailHref, formatDateTime, formatRelative } from './table/columns';

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
                <TableRow>
                  <TableCell colSpan={8} className="bg-bg-elevated/40">
                    {row.recentFires.length === 0 ? (
                      <span className="text-xs text-text-tertiary">No recent fires recorded.</span>
                    ) : (
                      <ul className="space-y-1 py-1">
                        {row.recentFires.map((fire) => (
                          <li key={`${fire.workflowId}:${fire.takenAt}`} className="flex items-center gap-3 text-xs">
                            <span title={formatDateTime(fire.takenAt)}>{formatRelative(fire.takenAt)}</span>
                            <span className={fire.lagMs > LAG_WARN_MS ? 'font-medium text-amber-400' : 'text-text-tertiary'}>
                              lag {Math.round(fire.lagMs / 1000)}s
                            </span>
                            <Link
                              className="font-mono underline-offset-2 hover:underline"
                              href={detailHref(fire.workflowId, fire.firstExecutionRunId ?? '')}
                            >
                              {fire.workflowId}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
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
