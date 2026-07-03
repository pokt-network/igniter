'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { Badge } from '@igniter/ui/components/badge'
import { PayloadBlock } from '@igniter/ui/components/PayloadBlock'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@igniter/ui/components/table'
import { Button } from '@igniter/ui/components/button'
import { cn } from '@igniter/ui/lib/utils'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import type {
  ActivityDetailView, ChildWorkflowDetailView,
} from '@igniter/temporal/workflow-detail'

import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import {
  GetWorkflowDetail, GetWorkflowHistoryJson, TerminateWorkflow,
} from '@/actions/Workflows'
import {
  CopyButton, detailHref, formatDateTime, formatElapsed, formatRelative, statusBadgeVariant,
} from '../table/columns'

export function WorkflowDetailClient({
  workflowId,
  runId,
}: {
  workflowId: string
  runId?: string
}) {
  const router = useRouter()
  const { addNotification } = useNotifications()
  const [confirmTerminate, setConfirmTerminate] = React.useState(false)
  const [isTerminating, setIsTerminating] = React.useState(false)
  const [expandedActivities, setExpandedActivities] = React.useState<Record<number, boolean>>({})

  const query = useQuery({
    queryKey: ['workflow-detail', workflowId, runId ?? null],
    queryFn: async () => {
      const result = await GetWorkflowDetail(workflowId, runId)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 10_000 : false),
  })

  const detail = query.data
  const goBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/admin/workflows?tab=workflows')
  }

  const downloadHistory = async () => {
    const result = await GetWorkflowHistoryJson(workflowId, runId)
    if (!result.success) {
      addNotification({ id: 'history-download-error', type: 'error', content: result.error.message })
      return
    }
    const blob = new Blob([result.data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workflowId}.${detail?.runId ?? runId ?? 'latest'}.history.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const terminate = async () => {
    if (!detail) return
    setIsTerminating(true)
    try {
      const result = await TerminateWorkflow(detail.workflowId, detail.runId)
      if (!result.success) throw new Error(result.error.message)
      await query.refetch()
    } catch (err) {
      addNotification({
        id: 'terminate-workflow-error',
        type: 'error',
        content: err instanceof Error ? err.message : 'Failed to terminate workflow',
      })
    } finally {
      setIsTerminating(false)
      setConfirmTerminate(false)
    }
  }

  // ---- error / loading states (spec §4 a-c + NotFound) ----
  if (query.isError && !query.data) {
    const message = query.error instanceof Error ? query.error.message : String(query.error)
    const notFound = /not found|NOT_FOUND/i.test(message)
    return (
      <div className="space-y-4">
        <BackLink onClick={goBack} />
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-400">
            {notFound ? 'Workflow not found (it may have aged out of visibility retention).' : 'Failed to load workflow.'}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-text-secondary">{workflowId}</p>
          {!notFound && <p className="mt-2 text-xs text-red-300">{message}</p>}
          <Button size="sm" variant="outline" className="mt-3" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }
  if (!detail) return <DetailSkeleton onBack={goBack} />

  const refreshFailing = query.isError && !!query.data

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="space-y-3">
        <BackLink onClick={goBack} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">{detail.type}</h1>
              <Badge variant={statusBadgeVariant(detail.status)}>{detail.status}</Badge>
              {refreshFailing && (
                <span className="text-xs text-amber-400">
                  last updated {formatRelative(new Date(query.dataUpdatedAt).toISOString())} — refresh failing
                </span>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 break-all font-mono text-xs text-text-secondary">
              {detail.workflowId}
              <CopyButton value={detail.workflowId} />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => query.refetch()}>Refresh</Button>
            <Button size="sm" variant="outline" onClick={downloadHistory}>Download history (JSON)</Button>
            {detail.status === 'RUNNING' && (
              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => setConfirmTerminate(true)}>
                Terminate
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Details card */}
      <div className="rounded-xl border border-border-primary p-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
          <MetaRow label="Run ID" mono copy value={detail.runId} />
          <MetaRow label="Task queue" value={detail.taskQueue} />
          <MetaRow label="Started" value={formatDateTime(detail.startTime)} />
          <MetaRow label="Closed" value={detail.closeTime ? formatDateTime(detail.closeTime) : '—'} />
          <MetaRow label="Elapsed" value={formatElapsed(detail.elapsedMs)} />
          <MetaRow label="History length" value={String(detail.historyLength)} />
          {detail.scheduledById && (
            <MetaRow label="Scheduled by">
              <Link className="break-all font-mono text-xs underline-offset-2 hover:underline" href="/admin/workflows?tab=schedules">
                {detail.scheduledById}
              </Link>
            </MetaRow>
          )}
          {detail.parent && (
            <MetaRow label="Parent">
              <Link className="break-all font-mono text-xs underline-offset-2 hover:underline" href={detailHref(detail.parent.workflowId, detail.parent.runId)}>
                {detail.parent.workflowId}
              </Link>
            </MetaRow>
          )}
          {detail.nextRunId && (
            <MetaRow label="Next run">
              <Link className="break-all font-mono text-xs underline-offset-2 hover:underline" href={detailHref(detail.workflowId, detail.nextRunId)}>
                {detail.nextRunId}
              </Link>
            </MetaRow>
          )}
        </dl>
        {detail.searchAttributes && (
          <div className="mt-4">
            <PayloadBlock label="Search attributes" text={detail.searchAttributes.text} collapsedLines={4} />
          </div>
        )}
      </div>

      {/* Stuck-workflow banner — RUNNING only (spec §4.2): a recovered/closed run may
          still carry historical WorkflowTaskFailed data in the view (useful forensics),
          but the present-tense "failing" banner must not show on closed workflows */}
      {detail.workflowTaskProblem && detail.status === 'RUNNING' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-400">
            Workflow task failing — attempt {detail.workflowTaskProblem.attempt}
            {detail.workflowTaskProblem.cause ? `: ${detail.workflowTaskProblem.cause}` : ''}
            {detail.workflowTaskProblem.message ? ` — ${detail.workflowTaskProblem.message}` : ''}
          </p>
          {detail.workflowTaskProblem.stackTrace && (
            <div className="mt-2">
              <PayloadBlock label="Workflow task failure stack" variant="error" text={detail.workflowTaskProblem.stackTrace} />
            </div>
          )}
        </div>
      )}

      {/* Failure banner */}
      {detail.failure && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-400">
            {detail.failure.type ? `${detail.failure.type}: ` : ''}{detail.failure.message}
          </p>
          {detail.failure.stackTrace && (
            <div className="mt-2">
              <PayloadBlock label="Stack trace" variant="error" text={detail.failure.stackTrace} />
            </div>
          )}
          {detail.failure.details && (
            <div className="mt-2">
              <PayloadBlock
                label="Details"
                variant="error"
                text={detail.failure.details.text}
                truncated={detail.failure.details.truncated}
                decodeError={detail.failure.details.decodeError}
              />
            </div>
          )}
        </div>
      )}

      {/* History-degraded notice (spec error state b) */}
      {detail.historyError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-400">
          History unavailable: {detail.historyError}. Header data comes from describe(); activities, IO and children are hidden.
        </div>
      )}

      {!detail.historyError && (
        <>
          {/* Input / Output */}
          <section className="space-y-3 rounded-xl border border-border-primary p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Input / Output</h2>
            {detail.input
              ? <PayloadBlock label="Input" text={detail.input.text} truncated={detail.input.truncated} decodeError={detail.input.decodeError} defaultExpanded />
              : <p className="text-xs text-text-tertiary">No input recorded.</p>}
            {detail.output
              ? <PayloadBlock label="Result" text={detail.output.text} truncated={detail.output.truncated} decodeError={detail.output.decodeError} defaultExpanded />
              : detail.status === 'RUNNING'
                ? <p className="text-xs text-text-tertiary">Still running — no result yet.</p>
                : null}
          </section>

          {/* Activities */}
          <section className="space-y-3 rounded-xl border border-border-primary p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Activities ({detail.activities.length})
            </h2>
            <ActivitiesTable
              activities={detail.activities}
              expanded={expandedActivities}
              onToggle={(id) => setExpandedActivities((e) => ({ ...e, [id]: !e[id] }))}
            />
          </section>

          {/* Children */}
          {detail.children.length > 0 && (
            <section className="space-y-3 rounded-xl border border-border-primary p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                Child workflows ({detail.children.length})
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Initiated</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.children.map((child) => (
                    <TableRow key={`${child.workflowId}:${child.initiatedAt}`}>
                      <TableCell>
                        <Link className="break-all font-mono text-xs underline-offset-2 hover:underline"
                              href={detailHref(child.workflowId, child.runId ?? '')}>
                          {child.workflowId}
                        </Link>
                      </TableCell>
                      <TableCell>{child.type}</TableCell>
                      <TableCell><ChildStatusBadge status={child.status} /></TableCell>
                      <TableCell title={formatDateTime(child.initiatedAt)}>{formatRelative(child.initiatedAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{child.durationMs != null ? formatElapsed(child.durationMs) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </>
      )}

      {confirmTerminate && detail && (
        <ConfirmationDialog
          title="Terminate Workflow"
          open={confirmTerminate}
          onClose={() => setConfirmTerminate(false)}
          footerActions={
            <>
              <Button variant="outline" onClick={() => setConfirmTerminate(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={terminate} disabled={isTerminating}>
                Terminate
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p>
              Terminate workflow <span className="font-mono">{detail.workflowId}</span> ({detail.type})? This cannot be undone.
            </p>
            <p className="text-sm text-amber-400">
              This may affect an in-flight transaction. The transaction row self-recovers and is
              re-dispatched, but proceed only if you understand the impact.
            </p>
          </div>
        </ConfirmationDialog>
      )}
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
    >
      <span aria-hidden="true">←</span>
      Back to Workflows
    </button>
  )
}

function MetaRow({
  label,
  value,
  mono,
  copy,
  children,
}: {
  label: string
  value?: string
  mono?: boolean
  copy?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className={cn('mt-0.5 flex items-center gap-1.5 text-sm', mono && 'font-mono text-xs break-all')}>
        {children ?? value}
        {copy && value && <CopyButton value={value} />}
      </dd>
    </div>
  )
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />
      <div className="animate-pulse space-y-6">
        <div className="h-24 rounded-xl border border-border-primary bg-bg-elevated/40" />
        <div className="h-40 rounded-xl border border-border-primary bg-bg-elevated/40" />
        <div className="h-40 rounded-xl border border-border-primary bg-bg-elevated/40" />
      </div>
    </div>
  )
}

function ChildStatusBadge({ status }: { status: ChildWorkflowDetailView['status'] }) {
  const variant = (() => {
    switch (status) {
      case 'COMPLETED':
        return 'success' as const
      case 'FAILED':
      case 'TERMINATED':
        return 'destructive' as const
      case 'TIMED_OUT':
        return 'warning' as const
      default:
        return 'secondary' as const
    }
  })()
  return <Badge variant={variant}>{status}</Badge>
}

function ActivityStatusBadge({ state }: { state: ActivityDetailView['state'] }) {
  const variant = (() => {
    switch (state) {
      case 'COMPLETED':
        return 'success' as const
      case 'FAILED':
        return 'destructive' as const
      case 'TIMED_OUT':
        return 'warning' as const
      case 'PENDING':
      case 'SCHEDULED':
      case 'STARTED':
        return 'info' as const
      case 'CANCELED':
        return 'secondary' as const
      default:
        return 'secondary' as const
    }
  })()
  return <Badge variant={variant}>{state}</Badge>
}

function ActivitiesTable({
  activities, expanded, onToggle,
}: {
  activities: ActivityDetailView[]
  expanded: Record<number, boolean>
  onToggle: (scheduledEventId: number) => void
}) {
  if (activities.length === 0) {
    return <p className="text-xs text-text-tertiary">No activities recorded.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>#</TableHead>
          <TableHead>Activity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {activities.map((act, index) => (
          <React.Fragment key={act.scheduledEventId}>
            <TableRow>
              <TableCell>
                <button type="button" aria-label="Toggle detail"
                        aria-expanded={!!expanded[act.scheduledEventId]}
                        className="text-text-secondary hover:text-text-primary"
                        onClick={() => onToggle(act.scheduledEventId)}>
                  {expanded[act.scheduledEventId] ? '▾' : '▸'}
                </button>
              </TableCell>
              <TableCell className="font-mono text-xs">{index + 1}</TableCell>
              <TableCell className="text-sm">{act.activityType}</TableCell>
              <TableCell><ActivityStatusBadge state={act.state} /></TableCell>
              <TableCell className="font-mono text-xs">
                {act.attempts} / {act.maxAttempts ?? '∞'}
              </TableCell>
              <TableCell title={act.startedAt ? formatDateTime(act.startedAt) : undefined}>
                {act.startedAt ? formatRelative(act.startedAt) : '—'}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {act.durationMs != null ? formatElapsed(act.durationMs) : '—'}
              </TableCell>
            </TableRow>
            {expanded[act.scheduledEventId] && (
              <TableRow>
                <TableCell colSpan={7} className="space-y-2 bg-bg-elevated/40">
                  {act.state === 'PENDING' && (
                    <p className="text-xs text-amber-400">
                      Pending ({act.pendingState ?? 'unknown'})
                      {act.nextRetryAt && ` · next retry ${formatRelative(act.nextRetryAt)}`}
                      {act.retryExpiresAt && ` · retries expire ${formatRelative(act.retryExpiresAt)}`}
                      {act.lastHeartbeatAt && ` · last heartbeat ${formatRelative(act.lastHeartbeatAt)}`}
                      {act.lastWorkerIdentity && ` · worker ${act.lastWorkerIdentity}`}
                    </p>
                  )}
                  {act.input && (
                    <PayloadBlock label="Input" text={act.input.text}
                                  truncated={act.input.truncated} decodeError={act.input.decodeError} />
                  )}
                  {act.result && (
                    <PayloadBlock label="Result" text={act.result.text}
                                  truncated={act.result.truncated} decodeError={act.result.decodeError} />
                  )}
                  {act.failure && (
                    <PayloadBlock label={`Failure${act.failure.type ? ` (${act.failure.type})` : ''}`}
                                  variant="error"
                                  text={[act.failure.message, act.failure.stackTrace].filter(Boolean).join('\n\n')} />
                  )}
                </TableCell>
              </TableRow>
            )}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  )
}
