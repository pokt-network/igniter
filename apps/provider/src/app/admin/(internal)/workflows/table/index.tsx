'use client'

import * as React from 'react'
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import type { WorkflowView, WorkflowListFilter, WorkflowStatus } from '@igniter/temporal/workflow-view'
import { ListWorkflows, TerminateWorkflow } from '@/actions/Workflows'
import { columns } from './columns'
import { PROVIDER_WORKFLOW_TYPES } from '../workflowTypes'

const SCOPES: Array<{ label: string; value: NonNullable<WorkflowListFilter['scope']> }> = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
]

const STATUS_OPTIONS: Array<{ label: string; value: WorkflowStatus | 'ALL' }> = [
  { label: 'Any status', value: 'ALL' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Terminated', value: 'TERMINATED' },
  { label: 'Timed Out', value: 'TIMED_OUT' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Continued as New', value: 'CONTINUED_AS_NEW' },
]

const ANY_TYPE = 'ALL'
const CUSTOM_TYPE = '__custom__'

function useUrlFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const read = {
    scope: (searchParams.get('scope') === 'running' ? 'running' : 'all') as 'all' | 'running',
    status: searchParams.get('status') ?? 'ALL',
    type: searchParams.get('type') ?? '',
    scheduledBy: searchParams.get('scheduledBy') ?? '',
    pageIndex: Math.max(0, Number(searchParams.get('page') ?? '0') || 0),
    pageSize: Math.max(1, Number(searchParams.get('pageSize') ?? '25') || 25),
  }

  const write = React.useCallback(
    (patch: Partial<Record<'scope' | 'status' | 'type' | 'scheduledBy' | 'page' | 'pageSize', string>>) => {
      const params = new URLSearchParams(searchParams.toString())
      const isFilterChange = 'scope' in patch || 'status' in patch || 'type' in patch || 'scheduledBy' in patch
      for (const [key, value] of Object.entries(patch)) {
        if (value === '' || value == null) params.delete(key)
        else params.set(key, value)
      }
      if (isFilterChange) params.delete('page')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return { ...read, write }
}

export default function WorkflowsTable() {
  const { addNotification } = useNotifications()
  const { scope, status, type, scheduledBy, pageIndex, pageSize, write } = useUrlFilters()

  const isKnownType = type === '' || (PROVIDER_WORKFLOW_TYPES as readonly string[]).includes(type)
  const [customType, setCustomType] = useState(!isKnownType)
  const [customTypeText, setCustomTypeText] = useState(isKnownType ? '' : type)
  const customTypeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (customTypeTimer.current) clearTimeout(customTypeTimer.current)
    }
  }, [])

  const [toTerminate, setToTerminate] = useState<WorkflowView | null>(null)
  const [isTerminating, setIsTerminating] = useState(false)

  const filter: WorkflowListFilter = {
    scope,
    status: status as WorkflowStatus | 'ALL',
    type: type || undefined,
    scheduledBy: scheduledBy || undefined,
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['workflows', scope, status, type, scheduledBy, pageIndex, pageSize],
    queryFn: async () => {
      const result = await ListWorkflows(filter, { pageIndex, pageSize })
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    refetchInterval: 15000,
  })

  const confirmTerminate = async () => {
    if (!toTerminate) return
    try {
      setIsTerminating(true)
      const result = await TerminateWorkflow(toTerminate.workflowId, toTerminate.runId)
      if (!result.success) throw new Error(result.error.message)
      await refetch()
    } catch (err) {
      addNotification({
        id: 'terminate-workflow-error',
        type: 'error',
        showTypeIcon: true,
        content: err instanceof Error ? err.message : 'Unable to terminate workflow.',
      })
    } finally {
      setIsTerminating(false)
      setToTerminate(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border-primary p-0.5">
          {SCOPES.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={scope === s.value ? 'default' : 'ghost'}
              onClick={() => write({ scope: s.value })}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <Select value={status} onValueChange={(value) => write({ status: value })}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={customType ? CUSTOM_TYPE : type || ANY_TYPE}
          onValueChange={(value) => {
            if (value === CUSTOM_TYPE) {
              setCustomType(true)
              return
            }
            if (customTypeTimer.current) clearTimeout(customTypeTimer.current)
            setCustomType(false)
            setCustomTypeText('')
            write({ type: value === ANY_TYPE ? '' : value })
          }}
        >
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TYPE}>Any type</SelectItem>
            {PROVIDER_WORKFLOW_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_TYPE}>Other…</SelectItem>
          </SelectContent>
        </Select>
        {customType && (
          <input
            type="text"
            placeholder="Filter by workflow type…"
            value={customTypeText}
            onChange={(e) => {
              const value = e.target.value
              setCustomTypeText(value)
              if (customTypeTimer.current) clearTimeout(customTypeTimer.current)
              customTypeTimer.current = setTimeout(() => write({ type: value }), 300)
            }}
            className="h-9 min-w-[220px] rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        )}
        {scheduledBy && (
          <span className="inline-flex h-9 max-w-96 items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 text-sm text-blue-300">
            Schedule
            <span className="truncate font-mono text-xs" title={scheduledBy}>
              {scheduledBy}
            </span>
            <button
              type="button"
              onClick={() => write({ scheduledBy: '' })}
              className="text-blue-300 hover:text-text-primary"
              aria-label="Clear schedule filter"
            >
              ✕
            </button>
          </span>
        )}
        <span className="ml-auto inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-border-primary bg-bg-elevated px-4 text-sm font-medium text-text-secondary">{data?.total ?? 0} workflows</span>
      </div>

      <DataTable
        isLoading={isLoading}
        isError={isError}
        refetch={refetch}
        columns={[
          ...columns,
          {
            id: 'actions',
            header: '',
            cell: ({ row }) =>
              row.original.status === 'RUNNING' ? (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => setToTerminate(row.original)}
                  >
                    Terminate
                  </Button>
                </div>
              ) : null,
          },
        ]}
        data={data?.items ?? []}
        manualPagination={{
          total: data?.total ?? 0,
          pageIndex,
          pageSize,
          onPageChange: (page) => write({ page: String(page) }),
          onPageSizeChange: (size) => write({ pageSize: String(size), page: '0' }),
        }}
      />

      {toTerminate && (
        <ConfirmationDialog
          title="Terminate Workflow"
          open={!!toTerminate}
          onClose={() => setToTerminate(null)}
          footerActions={
            <>
              <Button variant="outline" onClick={() => setToTerminate(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmTerminate} disabled={isTerminating}>
                Terminate
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p>
              Terminate workflow <span className="font-mono">{toTerminate.workflowId}</span> (
              {toTerminate.type})? This cannot be undone.
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
