'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { Badge } from '../badge';
import { Button } from '../button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../table';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../dialog';
import type { ScheduleFireView, ScheduleHealthRow, ScheduleHealthState } from '@igniter/temporal/workflow-view';
import type { ActionResult } from '../../lib/actionResult';

import { detailHref, formatDateTime, formatRelative, statusBadgeVariant } from './columns';
import type { WorkflowsActions } from './types';

const STATE_VARIANT: Record<ScheduleHealthState, 'success' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  healthy: 'success',
  paused: 'secondary',
  stale: 'warning',
  unhealthy: 'destructive',
  unknown: 'outline',
};

const LAG_WARN_MS = 30_000;

export function SchedulesTab({
  health,
  actions,
}: {
  health: UseQueryResult<ScheduleHealthRow[]>;
  actions: WorkflowsActions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = React.useState<{ kind: 'pause' | 'recreate'; scheduleId: string } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [resumeError, setResumeError] = React.useState<{ scheduleId: string; message: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const runAction = async (
    scheduleId: string,
    fn: () => Promise<ActionResult<void>>,
  ): Promise<string | null> => {
    if (busy) return null;
    setBusy(scheduleId);
    try {
      const result = await fn();
      if (!result.success) return result.error.message;
      await health.refetch();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(null);
    }
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const fn = confirm.kind === 'pause' ? actions.PauseSchedule : actions.RecreateSchedule;
    if (!fn) return;
    const message = await runAction(confirm.scheduleId, () => fn(confirm.scheduleId));
    if (message) setActionError(message);
    else setConfirm(null);
  };

  const resume = async (scheduleId: string) => {
    const fn = actions.ResumeSchedule;
    if (!fn) return;
    setResumeError(null);
    const message = await runAction(scheduleId, () => fn(scheduleId));
    if (message) setResumeError({ scheduleId, message });
  };

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
      </div>
      {resumeError && (
        <p className="mb-2 text-sm text-red-400">
          Resume failed for <span className="font-mono">{resumeError.scheduleId}</span>: {resumeError.message}
        </p>
      )}
      <Table containerClassName="max-h-[60vh]">
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-(--bg-root) [&_th]:border-b [&_th]:border-border-primary">
          <TableRow>
            <TableHead />
            <TableHead>Schedule</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Last fire</TableHead>
            <TableHead>Next fire</TableHead>
            <TableHead className="text-center">Unstuck</TableHead>
            <TableHead className="text-center">Recreated</TableHead>
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
                <TableCell className={`text-center font-mono ${row.unstucks > 0 ? 'text-amber-400' : ''}`}>
                  {row.unstucks}
                </TableCell>
                <TableCell
                  className={`text-center font-mono ${row.recreations > 0 ? 'text-amber-400' : ''}`}
                  title={row.lastRecreatedAt ? formatDateTime(row.lastRecreatedAt) : undefined}
                >
                  {row.recreations}
                </TableCell>
                <TableCell className="max-w-56 truncate text-xs text-text-secondary" title={row.note ?? undefined}>
                  {row.note ?? '-'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {row.state === 'paused'
                      ? actions.ResumeSchedule && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => resume(row.scheduleId)}
                          >
                            Resume
                          </Button>
                        )
                      : actions.PauseSchedule && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setActionError(null);
                              setResumeError(null);
                              setConfirm({ kind: 'pause', scheduleId: row.scheduleId });
                            }}
                          >
                            Pause
                          </Button>
                        )}
                    {actions.RecreateSchedule && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => {
                          setActionError(null);
                          setResumeError(null);
                          setConfirm({ kind: 'recreate', scheduleId: row.scheduleId });
                        }}
                      >
                        Recreate
                      </Button>
                    )}
                    <button
                      type="button"
                      className="text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                      onClick={() => viewRuns(row.scheduleId)}
                    >
                      View runs
                    </button>
                  </div>
                </TableCell>
              </TableRow>
              {expanded[row.scheduleId] && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="px-4 pb-4 pt-1">
                    <RecentFires scheduleId={row.scheduleId} fires={row.recentFires} actions={actions} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>{confirm?.kind === 'pause' ? 'Pause Schedule' : 'Recreate Schedule'}</DialogTitle>
          {confirm && (
            <div className="flex flex-col gap-2">
              {confirm.kind === 'pause' ? (
                <p>
                  Pause schedule <span className="font-mono">{confirm.scheduleId}</span>? It stops firing
                  until resumed — the watchdog never auto-resumes a paused schedule.
                </p>
              ) : (
                <>
                  <p>
                    Recreate schedule <span className="font-mono">{confirm.scheduleId}</span>? This deletes
                    it; the workflows worker recreates it with canonical config within ~30 seconds and its
                    heal counters reset.
                  </p>
                  <p className="text-sm text-amber-400">
                    If the worker&apos;s watchdog runs in observe mode or is disabled, the schedule stays
                    deleted until the worker restarts.
                  </p>
                </>
              )}
              {actionError && <p className="text-sm text-red-400">{actionError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={!!busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.kind === 'recreate' ? 'destructive' : 'default'}
              disabled={!!busy}
              onClick={runConfirmed}
            >
              {confirm?.kind === 'pause' ? 'Pause' : 'Recreate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const FIRE_GRID = 'grid grid-cols-[100px_80px_minmax(0,1fr)_140px] items-center gap-x-4';

function RecentFires({
  scheduleId,
  fires,
  actions,
}: {
  scheduleId: string;
  fires: ScheduleFireView[];
  actions: WorkflowsActions;
}) {
  // Lazy status lookup: one visibility query per expanded schedule, matched by workflowId.
  const runs = useQuery({
    queryKey: ['schedule-runs', scheduleId],
    queryFn: async () => {
      const result = await actions.ListWorkflows({ scheduledBy: scheduleId }, { pageIndex: 0, pageSize: 25 });
      if (!result.success) throw new Error(result.error.message);
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
