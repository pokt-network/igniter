'use client'

import { ColumnDef } from '@igniter/ui/components/table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import type { WorkflowView, WorkflowStatus } from '@igniter/temporal/workflow-view'

const STATUS_STYLE: Record<string, string> = {
  RUNNING: 'bg-blue-500/15 text-blue-400',
  COMPLETED: 'bg-green-500/15 text-green-400',
  FAILED: 'bg-red-500/15 text-red-400',
  TERMINATED: 'bg-red-500/15 text-red-400',
  TIMED_OUT: 'bg-amber-500/15 text-amber-400',
  CANCELLED: 'bg-neutral-500/15 text-neutral-300',
  CONTINUED_AS_NEW: 'bg-neutral-500/15 text-neutral-300',
  UNKNOWN: 'bg-neutral-500/15 text-neutral-300',
  UNSPECIFIED: 'bg-neutral-500/15 text-neutral-300',
}

function formatStatus(status: WorkflowStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
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

export const columns: Array<ColumnDef<WorkflowView> & CsvColumnDef<WorkflowView>> = [
  {
    accessorKey: 'workflowId',
    header: 'Workflow ID',
    cell: ({ row }) => (
      <span className="font-mono text-xs break-all">{row.getValue('workflowId')}</span>
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
      return (
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN}`}
        >
          {formatStatus(status)}
        </span>
      )
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
]
