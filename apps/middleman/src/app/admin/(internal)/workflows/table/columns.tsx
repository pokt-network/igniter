'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ColumnDef } from '@igniter/ui/components/table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import { Badge } from '@igniter/ui/components/badge'
import type { WorkflowView, WorkflowStatus } from '@igniter/temporal/workflow-view'

function formatStatus(status: WorkflowStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function statusBadgeVariant(
  status: WorkflowStatus,
): 'info' | 'success' | 'destructive' | 'warning' | 'secondary' {
  switch (status) {
    case 'RUNNING':
      return 'info'
    case 'COMPLETED':
      return 'success'
    case 'FAILED':
    case 'TERMINATED':
      return 'destructive'
    case 'TIMED_OUT':
      return 'warning'
    default:
      return 'secondary'
  }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function formatElapsed(ms: number): string {
  if (ms < 0) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function formatRelative(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '-'
  const diff = new Date(iso).getTime() - nowMs
  const abs = Math.abs(diff)
  const unit =
    abs < 60_000
      ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`
  return diff <= 0 ? `${unit} ago` : `in ${unit}`
}

export function detailHref(workflowId: string, runId?: string | null): string {
  const base = `/admin/workflows/${encodeURIComponent(workflowId)}`
  return runId ? `${base}?runId=${encodeURIComponent(runId)}` : base
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (non-secure context); ignore
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="text-text-tertiary hover:text-text-primary"
      title="Copy"
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

export const columns: Array<ColumnDef<WorkflowView> & CsvColumnDef<WorkflowView>> = [
  {
    accessorKey: 'workflowId',
    header: 'Workflow ID',
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <Link
          href={detailHref(row.original.workflowId, row.original.runId)}
          title={row.original.workflowId}
          className="block max-w-[480px] truncate font-mono text-xs text-text-primary underline-offset-2 hover:underline"
        >
          {row.original.workflowId}
        </Link>
        <CopyButton value={row.original.workflowId} />
      </span>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Type',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.getValue('status') as WorkflowStatus
      return <Badge variant={statusBadgeVariant(status)}>{formatStatus(status)}</Badge>
    },
  },
  {
    accessorKey: 'startTime',
    header: 'Started',
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-text-secondary">
        {formatDateTime(row.getValue('startTime'))}
      </span>
    ),
  },
  {
    accessorKey: 'elapsedMs',
    header: 'Elapsed',
    cell: ({ row }) => (
      <span className="font-mono text-text-secondary">
        {formatElapsed(row.getValue('elapsedMs'))}
      </span>
    ),
  },
  {
    accessorKey: 'scheduledById',
    header: 'Origin',
    cell: ({ row }) =>
      row.original.scheduledById ? (
        <Badge variant="secondary" title={row.original.scheduledById}>
          scheduled
        </Badge>
      ) : null,
  },
]
