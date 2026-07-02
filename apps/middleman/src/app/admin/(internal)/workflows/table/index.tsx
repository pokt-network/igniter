'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@igniter/ui/components/dialog'
import type { WorkflowView, WorkflowListFilter, WorkflowStatus } from '@igniter/temporal/workflow-view'
import { ListWorkflows, TerminateWorkflow } from '@/actions/Workflows'
import { columns } from './columns'

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
]

export default function WorkflowsTable() {
  const [scope, setScope] = useState<NonNullable<WorkflowListFilter['scope']>>('all')
  const [status, setStatus] = useState<WorkflowStatus | 'ALL'>('ALL')
  const [typeFilter, setTypeFilter] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [toTerminate, setToTerminate] = useState<WorkflowView | null>(null)
  const [isTerminating, setIsTerminating] = useState(false)
  const [termError, setTermError] = useState<string | null>(null)

  const filter: WorkflowListFilter = { scope, status, type: typeFilter.trim() || undefined }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['workflows', scope, status, typeFilter, pageIndex, pageSize],
    queryFn: async () => {
      const result = await ListWorkflows(filter, { pageIndex, pageSize })
      if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to load workflows')
      return result.data
    },
    refetchInterval: 15000,
  })

  const confirmTerminate = async () => {
    if (!toTerminate) return
    setTermError(null)
    try {
      setIsTerminating(true)
      const result = await TerminateWorkflow(toTerminate.workflowId, toTerminate.runId)
      if (!result.success) throw new Error(result.error ?? 'Failed to terminate workflow')
      await refetch()
      setToTerminate(null)
    } catch (err) {
      setTermError(err instanceof Error ? err.message : 'Unable to terminate workflow.')
    } finally {
      setIsTerminating(false)
    }
  }

  const resetPage = () => setPageIndex(0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border-primary p-0.5">
          {SCOPES.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={scope === s.value ? 'default' : 'ghost'}
              onClick={() => {
                setScope(s.value)
                resetPage()
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as WorkflowStatus | 'ALL')
            resetPage()
          }}
        >
          <SelectTrigger className="h-9 min-w-[160px]">
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
        <input
          type="text"
          placeholder="Filter by workflow type…"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value)
            resetPage()
          }}
          className="h-9 min-w-[220px] rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
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
                    onClick={() => {
                      setTermError(null)
                      setToTerminate(row.original)
                    }}
                  >
                    Terminate
                  </Button>
                </div>
              ) : null,
          },
        ]}
        data={data?.items ?? []}
        countLabel="workflows"
        manualPagination={{
          total: data?.total ?? 0,
          pageIndex,
          pageSize,
          onPageChange: setPageIndex,
          onPageSizeChange: (size) => {
            setPageSize(size)
            setPageIndex(0)
          },
        }}
      />

      <Dialog open={!!toTerminate} onOpenChange={(open) => !open && setToTerminate(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Terminate Workflow</DialogTitle>
          {toTerminate && (
            <div className="flex flex-col gap-2">
              <p>
                Terminate workflow <span className="font-mono">{toTerminate.workflowId}</span> (
                {toTerminate.type})? This cannot be undone.
              </p>
              <p className="text-sm text-amber-400">
                This may affect an in-flight transaction. The transaction row self-recovers and is
                re-dispatched, but proceed only if you understand the impact.
              </p>
              {termError && <p className="text-sm text-red-400">{termError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setToTerminate(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmTerminate} disabled={isTerminating}>
              Terminate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
