'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import ErrorRetry from '@igniter/ui/components/ErrorRetry'
import NoData from '@igniter/ui/components/NoData'
import Address from '@igniter/ui/components/Address'
import { Button } from '@igniter/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import type { ColumnDef } from '@igniter/ui/components/table'
import { GetAnalyticsBreakdown, type AnalyticsFilters } from '@/actions/Analytics'
import type { AnalyticsBreakdownDimension, AnalyticsGroupRow } from '@/lib/dal/analytics'
import { weekRangeLabel } from '@/lib/analytics/coverage'
import { upoktToPoktString } from '@/lib/analytics/csv'
import { unwrap } from './unwrap'
import { countText, formatCount, poktText } from './format'
import { moneyColumns, Num } from './table'
import { ComparisonRows, TimeChart, type ComparisonMetric } from './Comparison'
import { Refreshing, Skeleton } from './refreshing'
import { Badge, Card, csvName, DetailsPanel, periodLabel } from './ui'

export const DIMENSIONS: Array<{ value: AnalyticsBreakdownDimension; label: string; explanation: string }> = [
  { value: 'service', label: 'Services', explanation: 'See each selected service on its own. The combined result uses total POKT amounts, not an average of service results.' },
  { value: 'supplier', label: 'Suppliers', explanation: 'Each row follows one of your suppliers: its own payments against its equal share in the sessions it was selected for.' },
  { value: 'owner', label: 'Current owner', explanation: 'Your suppliers grouped by their current stake owner, or by the owner they were delivered to while the stake owner is not known. Historical results are grouped by each supplier’s current owner, not the owner it had at the time.' },
  { value: 'week', label: 'Week', explanation: 'Compare the weeks of the period. A week cut by the period has fewer days and weaker evidence.' },
  { value: 'application', label: 'Application', explanation: 'Compare the requesting application addresses of the sessions with yours.' },
  { value: 'selected', label: 'Selected supplier count', explanation: 'Group sessions by how many of your suppliers were in the roster. This is separate from running more or fewer suppliers.' },
  { value: 'value', label: 'Session value', explanation: 'Group by the session’s payout pool, in four bands with the same number of sessions. It measures settled payouts, not all possible demand.' },
]

export const isDimension = (v: string | null): v is AnalyticsBreakdownDimension => DIMENSIONS.some((d) => d.value === v)

/** Session value groups without a band: settled with no V, and not settled yet (the DAL's keys). */
const VALUE_NO_PAYOUT = 'no_payout'
const VALUE_NOT_SETTLED = 'not_settled'

/** Groups shown at first; Show more adds the next ones. */
const FIRST_GROUPS = 12
const MORE_GROUPS = 24

function groupLabel(dim: AnalyticsBreakdownDimension, row: AnalyticsGroupRow, period?: { from: string; to: string }): string {
  switch (dim) {
    case 'week': return period ? weekRangeLabel(row.key, period.from, period.to) : row.key
    case 'owner': return row.key || 'Owner not known yet'
    case 'selected': return `${row.key} of yours`
    case 'value':
      if (row.key === VALUE_NO_PAYOUT) return 'No payout'
      if (row.key === VALUE_NOT_SETTLED) return 'Not settled yet'
      return `Band ${row.key}: ${poktText(row.minV ?? '0', 2)} to ${poktText(row.maxV ?? '0', 2)}`
    default: return row.key
  }
}

function GroupLabel({ dim, row, period }: { dim: AnalyticsBreakdownDimension; row: AnalyticsGroupRow; period?: { from: string; to: string } }) {
  const isAddress = (dim === 'supplier' || dim === 'application' || dim === 'owner') && row.key.startsWith('pokt1')
  if (isAddress) return <Address address={row.key} />
  const muted = !row.key || (dim === 'value' && (row.key === VALUE_NO_PAYOUT || row.key === VALUE_NOT_SETTLED))
  return <span className={muted ? 'text-text-tertiary' : ''}>{groupLabel(dim, row, period)}</span>
}

export default function BreakdownTab({
  filters,
  dim,
  onDim,
  period,
}: {
  filters: AnalyticsFilters
  dim: AnalyticsBreakdownDimension
  onDim: (dim: AnalyticsBreakdownDimension) => void
  /** The header's period: shown while this tab's own read loads. Labels and files use the read's own period. */
  period?: { from: string; to: string }
}) {
  const [metric, setMetric] = React.useState<ComparisonMetric>('difference')
  const [limit, setLimit] = React.useState(FIRST_GROUPS)
  React.useEffect(() => setLimit(FIRST_GROUPS), [dim, JSON.stringify(filters)]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isError, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['analytics-breakdown', filters, dim],
    queryFn: () => unwrap(GetAnalyticsBreakdown(filters, dim)),
    refetchOnWindowFocus: false,
    // A filter change keeps the previous groups on screen (dimmed); a new dimension starts from its own skeleton.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === dim ? previous : undefined),
    // The same view within half a minute is not fetched again (the first render's server read included).
    staleTime: 30_000,
  })
  const current = DIMENSIONS.find((d) => d.value === dim)!
  const groups = data?.rows
  // The period this read covered: week labels and the file name never use another read's.
  const readPeriod = data?.period

  const columns = React.useMemo(() => [
    {
      accessorKey: 'key',
      header: current.label,
      csvHeader: current.label,
      // A value band is exported as its key; its exact V range follows in POKT.
      csvFormatterFn: (r: AnalyticsGroupRow) => (dim === 'selected' || dim === 'week' ? groupLabel(dim, r, readPeriod) : r.key || groupLabel(dim, r)),
      cell: ({ row }: { row: { original: AnalyticsGroupRow } }) => <GroupLabel dim={dim} row={row.original} period={readPeriod} />,
    },
    ...(dim === 'value'
      ? [
          // In the CSV only (hidden on screen, where the band label shows the range).
          { accessorKey: 'minV', header: 'Min V', csvHeader: 'Min V (POKT)', csvFormatterFn: (r: AnalyticsGroupRow) => upoktToPoktString(r.minV) },
          { accessorKey: 'maxV', header: 'Max V', csvHeader: 'Max V (POKT)', csvFormatterFn: (r: AnalyticsGroupRow) => upoktToPoktString(r.maxV) },
        ]
      : []),
    ...moneyColumns<AnalyticsGroupRow>(),
    {
      accessorKey: 'days',
      header: () => <div className="text-right">Days</div>,
      meta: { headerAlign: 'right' },
      csvHeader: 'Days',
      csvFormatterFn: (r: AnalyticsGroupRow) => String(r.days),
      cell: ({ row }: { row: { original: AnalyticsGroupRow } }) => <Num>{formatCount(row.original.days)}</Num>,
    },
  ] as Array<ColumnDef<AnalyticsGroupRow>>, [dim, current.label, readPeriod])

  const shown = (groups ?? []).slice(0, limit)
  const rows = shown.map((r) => ({
    key: r.key || '-',
    label: <GroupLabel dim={dim} row={r} period={readPeriod} />,
    note: `${countText(r.days)} ${r.days === 1 ? 'day' : 'days'} with data · ${countText(r.sessions)} sessions`,
    y: r.y,
    b: r.b,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <label className="flex flex-row items-center gap-3 text-xs text-text-secondary">
          Compare by
          <Select value={dim} onValueChange={(v) => onDim(v as AnalyticsBreakdownDimension)}>
            <SelectTrigger className="min-w-52 w-fit gap-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <div className="flex flex-row items-center gap-2 text-xs text-text-tertiary">
          {groups && <Badge tone="muted">{countText(groups.length)} {groups.length === 1 ? 'group' : 'groups'}</Badge>}
          <span>{periodLabel((readPeriod ?? period)?.from, (readPeriod ?? period)?.to)}</span>
        </div>
      </div>

      {isError && !groups ? <ErrorRetry onRetry={() => refetch()} /> : isLoading || !groups ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[560px]" />
        </div>
      ) : groups.length === 0 ? (
        <Refreshing active={isFetching && isPlaceholderData}><NoData label="No data for this period yet." /></Refreshing>
      ) : (
        <Refreshing active={isFetching && isPlaceholderData}>
          <div className="flex flex-col gap-4">
            <Card>
              <div className="flex flex-row flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-text-primary">{current.label}</h2>
                  <p className="mt-1.5 text-sm text-text-secondary">{current.explanation}</p>
                </div>
                <div className="flex flex-row rounded-lg border border-border-primary bg-bg-elevated p-1" role="group" aria-label="Chart measure">
                  {([['difference', 'Vs equal share'], ['amounts', 'POKT amounts']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={metric === id}
                      onClick={() => setMetric(id)}
                      className={`rounded-md px-3 py-1.5 text-xs ${metric === id ? 'bg-bg-surface font-semibold text-accent shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {dim === 'week'
                ? <TimeChart metric={metric} points={groups.map((r) => ({ key: r.key, label: groupLabel(dim, r, readPeriod), y: r.y, b: r.b }))} />
                : <ComparisonRows rows={rows} metric={metric} />}
              {dim !== 'week' && groups.length > shown.length && (
                <Button variant="secondary" size="sm" className="mt-4" onClick={() => setLimit((l) => l + MORE_GROUPS)}>
                  Show {Math.min(MORE_GROUPS, groups.length - shown.length)} more groups
                </Button>
              )}
              <p className="mt-4 text-xs text-text-tertiary leading-relaxed">
                {metric === 'amounts'
                  ? 'Dots show actual and equal-share amounts on a shared POKT scale.'
                  : '0% means equal share. Right of the reference means higher earnings; left means lower.'}
                {' '}The percentage and Actual ÷ equal share describe the same comparison.
              </p>
            </Card>
            <DetailsPanel title="Exact amounts and group evidence">
              <DataTable bounded={false} columns={columns as never} data={groups} countLabel="groups" columnVisibility={{ minV: false, maxV: false }} csvFilename={readPeriod ? csvName(`analytics-by-${dim}`, readPeriod, filters.services) : undefined} stickyHeader={false} />
            </DetailsPanel>
          </div>
        </Refreshing>
      )}
    </div>
  )
}
