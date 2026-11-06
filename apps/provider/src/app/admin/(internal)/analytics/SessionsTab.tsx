'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import Address from '@igniter/ui/components/Address'
import { Button } from '@igniter/ui/components/button'
import { RightArrowIcon } from '@igniter/ui/assets'
import type { ColumnDef } from '@igniter/ui/components/table'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { ListAnalyticsSessions, type AnalyticsFilters } from '@/actions/Analytics'
import type { AnalyticsSessionPhase, AnalyticsSessionRow } from '@/lib/dal/analytics'
import { Refreshing } from './refreshing'
import { unwrap } from './unwrap'
import { formatCount, formatDay, Pokt } from './format'
import { Num } from './table'

export const PHASE_LABELS: Record<string, string> = {
  active: 'Active',
  grace: 'Grace period',
  waiting_claim: 'Waiting for claims',
  claiming: 'Claiming',
  waiting_proof: 'Waiting for proofs',
  proving: 'Proving',
  overdue: 'Overdue',
  settled: 'Settled',
}

/** A session's money is final once it settled with its money indexed; before that its amounts would read as 0. */
export function isFinal(row: Pick<AnalyticsSessionRow, 'phase' | 'moneyMissing'>): boolean {
  return row.phase === 'settled' && !row.moneyMissing
}

/** An amount of a session, or a dash while the session is not final. */
export function SessionAmount({ row, upokt }: { row: Pick<AnalyticsSessionRow, 'phase' | 'moneyMissing'>; upokt: string | null }) {
  if (!isFinal(row)) return <Num muted>—</Num>
  // Settled with no claim: nothing was paid, so the pool is a real zero.
  return <Num><Pokt upokt={upokt ?? '0'} /></Num>
}

export function phaseLabel(row: Pick<AnalyticsSessionRow, 'phase' | 'moneyMissing'>): string {
  const label = PHASE_LABELS[row.phase] ?? row.phase
  return row.phase === 'settled' && row.moneyMissing ? `${label}, money not indexed yet` : label
}

function OpenCell({ row, filters }: { row: AnalyticsSessionRow; filters: AnalyticsFilters }) {
  const addItem = useAddItemToDetail()
  return (
    <div className="flex items-center justify-end">
      <Button
        variant="ghost"
        size="sm"
        className="border-0"
        aria-label="Open session"
        onClick={() => addItem({ type: 'analyticsSession', body: { row, filters } })}
      >
        <RightArrowIcon style={{ width: '18px', height: '18px' }} />
      </Button>
    </div>
  )
}

const PHASES: Array<{ value: AnalyticsSessionPhase; label: string; description: string }> = [
  { value: 'all', label: 'All', description: 'Every session with at least one of your suppliers, newest first.' },
  { value: 'settled', label: 'Settled', description: 'Sessions settled with their money: their numbers are final.' },
  {
    value: 'in_progress',
    label: 'In progress',
    description: 'Sessions still active, in their grace period, or waiting for claims or proofs. Their money is not known yet.',
  },
  { value: 'money_missing', label: 'Money missing', description: 'Settled sessions whose money is not indexed yet.' },
]

/** Columns hidden while the list shows only sessions in progress: they have no money yet. */
const MONEY_COLUMNS = new Set(['poolUpokt', 'paidUpokt', 'equalShareUpokt'])

function sessionColumns(filters: AnalyticsFilters, phase: AnalyticsSessionPhase): ColumnDef<AnalyticsSessionRow>[] {
  const all: ColumnDef<AnalyticsSessionRow>[] = [
    {
      accessorKey: 'startHeight',
      header: 'Started',
      cell: ({ row }) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{formatDay(row.original.day)}</span>
          <span className="font-mono text-xs text-text-tertiary">height {formatCount(row.original.startHeight)}</span>
        </span>
      ),
    },
    { accessorKey: 'serviceId', header: 'Service' },
    { accessorKey: 'applicationId', header: 'Application', cell: ({ row }) => <Address address={row.original.applicationId} /> },
    { accessorKey: 'phase', header: 'Phase', cell: ({ row }) => <span className="text-text-secondary">{phaseLabel(row.original)}</span> },
    { accessorKey: 'rosterSize', header: () => <div className="text-right whitespace-nowrap">Roster</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <Num>{formatCount(row.original.rosterSize)}</Num> },
    { accessorKey: 'poolUpokt', header: () => <div className="text-right whitespace-nowrap">Session pool</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <SessionAmount row={row.original} upokt={row.original.poolUpokt} /> },
    { accessorKey: 'members', header: () => <div className="text-right whitespace-nowrap">Yours</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <Num>{formatCount(row.original.members)}</Num> },
    { accessorKey: 'paidUpokt', header: () => <div className="text-right whitespace-nowrap">Your actual</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <SessionAmount row={row.original} upokt={row.original.paidUpokt} /> },
    { accessorKey: 'equalShareUpokt', header: () => <div className="text-right whitespace-nowrap">Your equal share</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <SessionAmount row={row.original} upokt={row.original.equalShareUpokt} /> },
    { id: 'actions', cell: ({ row }) => <OpenCell row={row.original} filters={filters} /> },
  ]
  if (phase !== 'in_progress') return all
  return all.filter((c) => !('accessorKey' in c && MONEY_COLUMNS.has(String(c.accessorKey))))
}

/** One list of the scope's sessions, newest first, with a phase filter. */
export default function SessionsTab({ filters }: { filters: AnalyticsFilters }) {
  const [phase, setPhase] = React.useState<AnalyticsSessionPhase>('all')
  const [pageSize, setPageSize] = React.useState(25)
  // The page belongs to one filter and phase: a change starts at the first page in the same render.
  const listKey = `${JSON.stringify(filters)}|${phase}`
  const [page, setPage] = React.useState({ listKey, index: 0 })
  const pageIndex = page.listKey === listKey ? page.index : 0
  const setPageIndex = (index: number) => setPage({ listKey, index })

  const { data, isLoading, isError, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['analytics-sessions', filters, phase, pageIndex, pageSize],
    queryFn: () => unwrap(ListAnalyticsSessions(filters, { pageIndex, pageSize, phase })),
    refetchOnWindowFocus: false,
    // The previous page stays on screen (dimmed) while the next one loads, if it is of the same phase.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === phase ? previous : undefined),
    // The same view within half a minute is not fetched again (the first render's server read included).
    staleTime: 30_000,
  })
  const columns = React.useMemo(() => sessionColumns(filters, phase), [filters, phase])
  const current = PHASES.find((p) => p.value === phase)!

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-tertiary">Phase</span>
          <Select value={phase} onValueChange={(v) => setPhase(v as AnalyticsSessionPhase)}>
            <SelectTrigger className="min-w-44 w-fit gap-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PHASES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-text-tertiary pb-2.5">{current.description}</p>
      </div>
      <Refreshing active={isFetching && isPlaceholderData}>
        <DataTable
          key={phase}
          // Inside the page: the page scrolls as one, never a second scroll box for the list.
          bounded={false}
          columns={columns as never}
          data={data?.rows ?? []}
          isLoading={isLoading}
          isError={isError && !data}
          refetch={refetch}
          countLabel="sessions"
          stickyHeader={false}
          manualPagination={{
            total: data?.total ?? 0,
            pageIndex,
            pageSize,
            onPageChange: setPageIndex,
            onPageSizeChange: (size) => { setPageSize(size); setPageIndex(0) },
          }}
        />
      </Refreshing>
    </div>
  )
}
