'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import Summary from '@igniter/ui/components/Summary'
import DataTable from '@igniter/ui/components/DataTable/index'
import ErrorRetry from '@igniter/ui/components/ErrorRetry'
import NoData from '@igniter/ui/components/NoData'
import type { ColumnDef } from '@igniter/ui/components/table'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import { GetAnalyticsSummary, type AnalyticsFilters, type AnalyticsSummaryView } from '@/actions/Analytics'
import type { AnalyticsBreakdownDimension } from '@/lib/dal/analytics'
import { RANGE_MIN_DAYS, RANGE_MIN_SESSIONS, type AnalyticsSummary } from '@/lib/analytics/math'
import { chartsByDay, periodWeeks, weekRangeLabel } from '@/lib/analytics/coverage'
import { unwrap } from './unwrap'
import { countText, formatCount, poktText, signedPercent, toPokt, Pokt } from './format'
import { moneyColumns, VS_EQUAL_SHARE_HELP } from './table'
import { ComparisonRows, TimeChart } from './Comparison'
import { Refreshing, Skeleton } from './refreshing'
import { Badge, Card, CardDivider, csvName, DetailsPanel, Eyebrow, periodLabel, TextAction } from './ui'
import WhatIfCard from './WhatIfCard'

type ServiceRow = AnalyticsSummary['services'][number]

const serviceColumns = [
  { accessorKey: 'serviceId', header: 'Service', csvHeader: 'Service', csvFormatterFn: (r: ServiceRow) => r.serviceId },
  ...moneyColumns<ServiceRow>(),
] as Array<ColumnDef<ServiceRow>>

const AVG_YOURS_HELP =
  'In a session where at least one of yours was selected, how many of your suppliers were in its roster, on average.'
const RANGE_HELP =
  'The range the comparison would likely fall in if the period were repeated: days are resampled 2,000 times. A range that crosses 0% does not establish a difference.'
const LIMITED_HELP =
  `The 95% range needs at least ${RANGE_MIN_DAYS} days and ${RANGE_MIN_SESSIONS} sessions with an equal share in the period. With fewer, a few similar days would give a narrow range that looks more certain than it is.`
const RANGE_SCOPE = 'The range reflects variation across the recorded days in the period, not a forecast of future earnings.'
const SELECTION_HELP =
  'A session draws its roster from the staked suppliers of its service. This counts the network sessions of the selected services, on days that are final, and how many of them had at least one of your suppliers in the roster.'

/** Services shown on the summary; Compare services lists all. */
const SUMMARY_SERVICES = 5

export default function SummaryTab({
  filters,
  onCompare,
  initialData,
}: {
  filters: AnalyticsFilters
  onCompare: (dimension: AnalyticsBreakdownDimension) => void
  /** The server's read for the first render. */
  initialData?: AnalyticsSummaryView
}) {
  const { data, isLoading, isError, refetch, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['analytics-summary', filters],
    queryFn: () => unwrap(GetAnalyticsSummary(filters)),
    refetchOnWindowFocus: false,
    // Keep the previous numbers on screen (dimmed) while a new filter loads.
    placeholderData: (previous) => previous,
    initialData,
    // The same view within half a minute is not fetched again (the first render's server read included).
    staleTime: 30_000,
  })

  if (isError && !data) return <ErrorRetry onRetry={() => refetch()} />
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-[18px]">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-[18px]">
          <Skeleton className="h-[460px]" />
          <Skeleton className="h-[460px]" />
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    )
  }
  if (data.sessions === 0 && data.y === '0') {
    return (
      <Refreshing active={isFetching && isPlaceholderData}>
        <NoData label="No data for this period yet. The sync stores each day as it runs; earlier days come from the backfill." />
      </Refreshing>
    )
  }

  // The period this read covered: the chart's weeks and the file name never use another read's.
  const { from, to } = data.period

  return (
    <Refreshing active={isFetching && isPlaceholderData}>
      <div className="flex flex-col gap-[18px]">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-[18px]">
          <EarningsCard data={data} from={from} to={to} />
          <SelectionCard data={data} />
        </div>
        <TrendCard data={data} from={from} to={to} onCompare={onCompare} />
        {data.services.length > 1 && <ServicesCard data={data} onCompare={onCompare} />}
        {/* Keyed by the read itself (its period and references), never by the requested filter: a read with another
            reference starts the scenario at its recorded count again, and a placeholder read keeps the current one. */}
        <WhatIfCard key={whatIfKey(data)} references={data.selection} />
        <DetailsPanel title="Exact amounts and details">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailGroup
                title="Selection"
                rows={[
                  { label: 'Sessions with yours', value: formatCount(data.sessions) },
                  { label: 'Network sessions', value: formatCount(data.networkSessions), description: 'Settled sessions of the selected services in the period.' },
                  { label: 'Avg. of your suppliers in a session', value: data.meanSelected === null ? '—' : data.meanSelected.toFixed(2), description: AVG_YOURS_HELP },
                ]}
              />
              <DetailGroup
                title="Seats"
                rows={[
                  { label: 'Seats', value: formatCount(data.seats), description: 'Your suppliers in settled session rosters: one per session and supplier.' },
                  { label: 'Paid seats', value: formatCount(data.paid) },
                ]}
              />
              <DetailGroup
                title="Sessions"
                rows={[
                  { label: 'Session pools', value: <Pokt upokt={data.poolUpokt} />, description: 'What the sessions with one of yours paid all their members.' },
                  { label: 'Roster seats', value: formatCount(data.rosterSeats), description: 'The roster sizes of the sessions with one of yours, added up.' },
                ]}
              />
              <DetailGroup title="Coverage" rows={[{ label: 'Days with data', value: formatCount(data.days) }]} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">By service</p>
              <DataTable bounded={false} columns={serviceColumns as never} data={data.services} countLabel="services" csvFilename={csvName('analytics-summary-services', data.period, filters.services)} stickyHeader={false} />
            </div>
          </div>
        </DetailsPanel>
        <div className="flex flex-row flex-wrap items-center justify-between gap-4 rounded-2xl border border-border-primary bg-bg-elevated px-6 py-5">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Where do the differences come from?</h3>
            <p className="text-sm text-text-secondary">Compare your suppliers, owners, services, weeks or applications.</p>
          </div>
          <button
            type="button"
            onClick={() => onCompare('supplier')}
            className="inline-flex items-center gap-2 rounded-md border border-border-primary bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-hover"
          >
            Explore breakdown <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Refreshing>
  )
}

function EarningsCard({ data, from, to }: { data: AnalyticsSummary; from?: string; to?: string }) {
  const pct = data.percentVsEqualShare
  const range = data.range ? { low: (data.range.low - 1) * 100, high: (data.range.high - 1) * 100 } : null
  const unclear = range !== null && range.low <= 0 && range.high >= 0
  const headline = pct === null
    ? 'No equal share to compare yet'
    : unclear ? 'No clear earnings difference' : pct < 0 ? 'Earnings below equal share' : 'Earnings above equal share'
  const body = unclear
    ? 'The estimated range includes equal sharing. It does not establish an exact match.'
    : 'Your earnings compared with equal sharing among the suppliers selected into those sessions.'
  const y = toPokt(data.y)
  const b = toPokt(data.b)
  const maximum = Math.max(y, b, 1)
  const diff = BigInt(data.y) - BigInt(data.b)

  return (
    <Card>
      <div className="flex flex-row items-start justify-between gap-4">
        <Eyebrow muted>Earnings · {periodLabel(from, to)}</Eyebrow>
        <Badge>Observed comparison</Badge>
      </div>
      <h2 className="mt-3.5 max-w-[440px] text-2xl font-semibold tracking-tight text-text-primary">{headline}</h2>
      {pct !== null && (
        <div className="flex flex-row flex-wrap items-center justify-between gap-4 my-3">
          <div className={`text-[44px] leading-none font-semibold tracking-tighter tabular-nums ${pct < 0 ? 'text-warning' : 'text-accent'}`}>
            {signedPercent(pct)}
            <span className="block mt-2 text-base tracking-normal font-medium">vs equal share</span>
          </div>
          <div className="flex flex-row items-start gap-3 rounded-lg border border-border-primary bg-bg-elevated px-4 py-3">
            <div className="flex flex-col">
              <span className="text-[11px] text-text-tertiary">Actual ÷ equal share</span>
              <strong className="text-2xl font-semibold text-accent tabular-nums">{data.f === null ? '—' : data.f.toFixed(2)}</strong>
              <small className="text-[10px] text-text-tertiary">1.00 = equal share</small>
            </div>
            <QuickInfoPopOverIcon title="Actual ÷ equal share" description={VS_EQUAL_SHARE_HELP} url="" />
          </div>
        </div>
      )}
      <p className="text-sm text-text-secondary max-w-[470px]">{body}</p>
      {pct !== null && (
        <div className="mt-2 flex flex-col gap-1 text-xs text-text-tertiary">
          {range ? (
            <span className="flex flex-row items-center gap-1.5">
              95% range: {signedPercent(range.low)} to {signedPercent(range.high)}
              <QuickInfoPopOverIcon title="95% range" description={RANGE_HELP} url="" />
            </span>
          ) : (
            <span className="flex flex-row items-center gap-1.5">
              Limited history: {countText(data.rangeEvidence.informativeDays)} {data.rangeEvidence.informativeDays === 1 ? 'day' : 'days'} and{' '}
              {countText(data.rangeEvidence.positiveSessions)} {data.rangeEvidence.positiveSessions === 1 ? 'session' : 'sessions'} with an equal share
              <QuickInfoPopOverIcon title="Limited history" description={LIMITED_HELP} url="" />
            </span>
          )}
          <span>{RANGE_SCOPE}</span>
        </div>
      )}
      <div className="grid gap-4 my-5">
        {[['Actual earnings', data.y, y, 'var(--accent)'], ['Equal-share amount', data.b, b, 'var(--text-tertiary)']].map(([label, upokt, value, colour]) => (
          <div key={label as string} className="flex flex-col gap-1.5">
            <div className="flex flex-row justify-between gap-3 text-xs">
              <span className="text-text-secondary">{label as string}</span>
              <strong className="text-[13px] font-semibold tabular-nums text-text-primary">{poktText(upokt as string)}</strong>
            </div>
            <div className="h-[13px] rounded-[3px] bg-bg-elevated overflow-hidden">
              <div className="h-full rounded-[3px]" style={{ width: `${((value as number) / maximum) * 100}%`, background: colour as string }} />
            </div>
          </div>
        ))}
        <p className="text-xs text-text-tertiary">
          {diff < 0n ? '−' : '+'}{poktText((diff < 0n ? -diff : diff).toString())} {diff < 0n ? 'below' : 'above'} equal share
        </p>
      </div>
      <CardDivider>
        <div className="flex flex-row flex-wrap items-center justify-between gap-3 text-xs text-text-tertiary">
          <span>{countText(data.days)} days with data · {countText(data.sessions)} sessions with yours</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
            How is this compared?
            <QuickInfoPopOverIcon title="How is this compared?" description={VS_EQUAL_SHARE_HELP} url="" />
          </span>
        </div>
      </CardDivider>
    </Card>
  )
}

function SelectionCard({ data }: { data: AnalyticsSummary }) {
  const ready = data.presenceDays > 0
  const without = Math.max(0, data.presenceNetworkSessions - data.presenceSessions)
  return (
    <Card>
      <div className="flex flex-row items-start justify-between gap-4">
        <div>
          <Eyebrow>Observed on final days</Eyebrow>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">How often were you selected?</h2>
        </div>
        <QuickInfoPopOverIcon title="Selection" description={SELECTION_HELP} url="" />
      </div>
      <div className="pt-5">
        <div className="text-[40px] leading-tight font-semibold tracking-tighter tabular-nums text-text-primary">
          {ready && data.presence !== null ? `${countText(data.presence * 100, 1)}%` : '—'}
        </div>
        <p className="mt-1.5 text-sm text-text-secondary">
          {ready
            ? <>of network sessions of the selected services<br />selected at least one of your suppliers</>
            : 'Shown once a day of the period is final.'}
        </p>
        {ready && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="h-2.5 rounded-full bg-bg-elevated overflow-hidden">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (data.presenceSessions / Math.max(1, data.presenceNetworkSessions)) * 100)}%` }}
              />
            </div>
            <div className="flex flex-row justify-between text-xs text-text-secondary">
              <span><strong className="text-text-primary">{countText(data.presenceSessions)}</strong> with yours</span>
              <span><strong className="text-text-primary">{countText(without)}</strong> without yours</span>
            </div>
          </div>
        )}
        {ready && (
          <small className="block mt-2 text-xs text-text-tertiary">
            {countText(data.presenceSessions)} of {countText(data.presenceNetworkSessions)} network sessions, over {data.presenceDays} final {data.presenceDays === 1 ? 'day' : 'days'}.
            {data.services.length > 1 ? ` Across ${data.services.length} services.` : ''}
          </small>
        )}
        {data.presenceErrorDays.length > 0 && (
          <p className="mt-2 text-xs text-warning">
            Data check: {data.presenceErrorDays.length === 1 ? '1 day has' : `${data.presenceErrorDays.length} days have`} more of your sessions than the network total. Shown capped at 100%.
          </p>
        )}
      </div>
      <div className="flex flex-row items-center gap-3 pt-4 mt-5 border-t border-border-primary">
        <strong className="text-2xl font-semibold tabular-nums tracking-tight text-text-primary">
          {data.meanSelected === null ? '—' : data.meanSelected.toFixed(2)}
        </strong>
        <span className="text-xs text-text-tertiary">
          avg. of your suppliers in a session,<br />in sessions with at least one of yours
        </span>
        <QuickInfoPopOverIcon title="Avg. of your suppliers in a session" description={AVG_YOURS_HELP} url="" />
      </div>
      <CardDivider>
        <p className="text-xs text-text-tertiary">Selection measures access to a session’s requests. It does not measure the traffic served.</p>
      </CardDivider>
    </Card>
  )
}

function TrendCard({ data, from, to, onCompare }: { data: AnalyticsSummary; from?: string; to?: string; onCompare: (d: AnalyticsBreakdownDimension) => void }) {
  // A short period charts its days; a long one 7-day blocks from its first day (the last one shorter).
  const weekly = !!from && !!to && !chartsByDay(from, to)
  const points = weekly
    ? periodWeeks(from!, to!).map((w) => {
        const days = data.daily.filter((d) => d.day >= w.start && d.day <= w.end)
        const sum = (pick: (d: { y: string; b: string }) => string) => days.reduce((a, d) => a + BigInt(pick(d)), 0n).toString()
        return { key: w.start, label: w.label, y: sum((d) => d.y), b: sum((d) => d.b) }
      })
    : data.daily.map((d) => ({ key: d.day, label: weekRangeLabel(d.day, d.day, d.day), y: d.y, b: d.b }))
  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight text-text-primary">Earnings through the period</h2>
      <p className="mt-1.5 text-sm text-text-secondary max-w-[650px]">
        Actual and equal-share POKT by {weekly ? 'week' : 'day'}, using the same sessions.
      </p>
      <TimeChart points={points} />
      <p className="mt-4 text-xs text-text-tertiary leading-relaxed">
        Higher amounts can reflect more opportunity{weekly ? ' or a longer week' : ''}. The point details show the relative difference.
      </p>
      <TextAction onClick={() => onCompare('week')}>Compare weeks</TextAction>
    </Card>
  )
}

/** The What-if card's identity: the read's period and every reference it shows. */
function whatIfKey(data: AnalyticsSummaryView): string {
  const refs = data.selection.map((r) => `${r.serviceId}:${r.day}:${r.height}:${r.candidates}:${r.cap}:${r.ownEligible}`)
  return `${data.period.from}|${data.period.to}|${refs.join(',')}`
}

function ServicesCard({ data, onCompare }: { data: AnalyticsSummary; onCompare: (d: AnalyticsBreakdownDimension) => void }) {
  const rows = data.services
    .slice()
    .sort((a, c) => toPokt(c.b) - toPokt(a.b))
    .slice(0, SUMMARY_SERVICES)
    .map((s) => ({ key: s.serviceId, label: s.serviceId, note: `${s.days} ${s.days === 1 ? 'day' : 'days'} with data`, y: s.y, b: s.b }))
  return (
    <Card>
      <div className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">One provider. Different services.</h2>
          <p className="mt-1.5 text-sm text-text-secondary">The combined result uses POKT totals. A higher-value service has more influence.</p>
        </div>
        <TextAction onClick={() => onCompare('service')}>Compare services</TextAction>
      </div>
      <ComparisonRows rows={rows} />
      {data.services.length > SUMMARY_SERVICES && (
        <p className="mt-4 text-xs text-text-tertiary">
          Showing {SUMMARY_SERVICES} of {data.services.length} services. Compare services to see every result.
        </p>
      )}
    </Card>
  )
}

/** A titled group of detail rows. */
function DetailGroup({ title, rows }: { title: string; rows: React.ComponentProps<typeof Summary>['rows'] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-text-tertiary uppercase tracking-wide font-semibold">{title}</p>
      <Summary rows={rows} />
    </div>
  )
}
