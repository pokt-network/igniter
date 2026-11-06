'use client'

import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Layers, LineChart, ListChecks, RotateCcw } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@igniter/ui/components/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@igniter/ui/components/select'
import ErrorRetry from '@igniter/ui/components/ErrorRetry'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import { LoaderIcon } from '@igniter/ui/assets'
import { GetAnalyticsHeader, GetAnalyticsOptions, type AnalyticsFilters } from '@/actions/Analytics'
import type { AnalyticsBreakdownDimension } from '@/lib/dal/analytics'
import { countText, formatDay } from './format'
import { unwrap } from './unwrap'
import BackfillButton from './BackfillButton'
import ServicesFilter from './ServicesFilter'
import SummaryTab from './SummaryTab'
import BreakdownTab, { isDimension } from './BreakdownTab'
import SessionsTab from './SessionsTab'
import { periodDays, periodLabel } from './ui'
import { DAY_RE, filtersFromParams, filtersKey } from './params'
import type { AnalyticsHeader, AnalyticsOptions, AnalyticsSummaryView } from '@/actions/Analytics'

/** What the server read for the first render, so the page needs no round trip to show its first view. */
export type AnalyticsInitial = { options?: AnalyticsOptions; filters?: AnalyticsFilters; header?: AnalyticsHeader; summary?: AnalyticsSummaryView }

const TABS = ['summary', 'breakdown', 'sessions'] as const
type Tab = typeof TABS[number]

const CUSTOM = 'custom'
/** The URL parameters that make up the filters; Reset filters clears them. */
const FILTER_PARAMS = ['days', 'from', 'to', 'services'] as const

const bareTrigger = 'h-7 min-w-40 w-fit gap-2 border-0 bg-transparent px-0 shadow-none font-semibold focus:ring-0'
const dateInputClass =
  'h-7 rounded-md border border-border-primary bg-bg-input px-2 text-sm text-text-primary focus:outline-none focus:border-border-focus [color-scheme:light] dark:[color-scheme:dark]'

export default function AnalyticsView({ initial }: { initial?: AnalyticsInitial }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab: Tab = TABS.find((t) => t === searchParams.get('tab')) ?? 'summary'
  const byParam = searchParams.get('by')
  const dim: AnalyticsBreakdownDimension = isDimension(byParam) ? byParam : 'service'

  // Every filter lives in the URL, so a view can be shared and reloaded.
  const setParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') params.delete(k)
      else params.set(k, v)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const options = useQuery({
    queryKey: ['analytics-options'],
    queryFn: () => unwrap(GetAnalyticsOptions()),
    refetchOnWindowFocus: false,
    initialData: initial?.options,
    // Retention and services change rarely; the server's first read must not be fetched again at once.
    staleTime: 5 * 60_000,
  })

  const paramFrom = searchParams.get('from')
  const paramTo = searchParams.get('to')
  // No period in the URL: the last 7 days (or the whole retention when shorter).
  const { custom, ...parsed } = filtersFromParams((k) => searchParams.get(k), options.data?.defaultDays || 7)
  const filters: AnalyticsFilters = filtersKey(parsed)
  const services = filters.services ?? []
  const presetDays = filters.days
  // The server's first-render reads apply only while the filters are still the ones it read them for.
  const firstView = !!initial?.filters && JSON.stringify(filtersKey(initial.filters)) === JSON.stringify(filters)

  const header = useQuery({
    queryKey: ['analytics-header', filters],
    queryFn: () => unwrap(GetAnalyticsHeader(filters)),
    enabled: !!options.data,
    // Coverage moves only while some day of the period is still settling.
    refetchInterval: (query) => ((query.state.data?.openDays ?? 0) > 0 ? 60_000 : false),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    // The coverage line keeps its place (and its last text) while a new filter loads.
    placeholderData: (previous) => previous,
    initialData: firstView ? initial?.header : undefined,
  })

  if (options.isError) return <ErrorRetry onRetry={() => options.refetch()} />
  if (!options.data) {
    return (
      <div className="flex justify-center items-center h-[200px]">
        <LoaderIcon className="animate-spin" />
      </div>
    )
  }

  const { periodOptions, rangeBounds } = options.data
  const filtered = FILTER_PARAMS.some((k) => searchParams.has(k))
  // A custom range is shown as the server clamped it (the header echoes the period it used).
  const shownFrom = header.data?.from ?? paramFrom ?? rangeBounds.min
  const shownTo = header.data?.to ?? paramTo ?? rangeBounds.max
  const period = header.data && !header.isPlaceholderData ? { from: header.data.from, to: header.data.to } : undefined

  const onPeriod = (v: string) => {
    if (v === CUSTOM) setParams({ from: header.data?.from ?? rangeBounds.min, to: header.data?.to ?? rangeBounds.max, days: null })
    else setParams({ days: v, from: null, to: null })
  }
  const onDay = (which: 'from' | 'to', value: string) => {
    if (!DAY_RE.test(value)) return
    const clamp = (d: string) => (d < rangeBounds.min ? rangeBounds.min : d > rangeBounds.max ? rangeBounds.max : d)
    let from = which === 'from' ? clamp(value) : shownFrom
    let to = which === 'to' ? clamp(value) : shownTo
    if (from > to) {
      if (which === 'from') to = from
      else from = to
    }
    setParams({ from, to, days: null })
  }
  const compare = (next: AnalyticsBreakdownDimension) => {
    setParams({ tab: 'breakdown', by: next })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const h = header.data

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-row flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="text-[34px] leading-tight font-semibold tracking-tight text-text-primary">Your suppliers</h1>
          <div className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
            <span>
              {h ? <>{countText(h.suppliers)} of your suppliers · {countText(h.services)} {h.services === 1 ? 'service' : 'services'}</> : '…'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
              Who is included?
              <QuickInfoPopOverIcon
                title="Who is included?"
                description="Every supplier this provider holds the key of and has staked, including those unstaking or unstaked in the period. Only your own suppliers are ever read."
                url=""
              />
            </span>
          </div>
        </div>
        <div className="flex flex-row items-center gap-2">
          {filtered && (
            <button
              type="button"
              onClick={() => setParams(Object.fromEntries(FILTER_PARAMS.map((k) => [k, null])))}
              className="inline-flex items-center gap-2 rounded-md border border-border-primary bg-bg-surface px-3 py-2 text-sm font-semibold text-text-primary hover:bg-bg-hover"
            >
              <RotateCcw className="h-4 w-4" />
              Reset filters
            </button>
          )}
          <BackfillButton header={h} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_1fr] rounded-xl border border-border-primary bg-bg-surface">
        <Segment label="Services">
          <ServicesFilter bare services={options.data.services} value={services} onChange={(next) => setParams({ services: next.join(',') })} />
        </Segment>
        <Segment label="Period · UTC">
          <div className="flex flex-row flex-wrap items-center gap-2">
            <Select value={custom ? CUSTOM : String(presetDays)} onValueChange={onPeriod}>
              <SelectTrigger className={bareTrigger}>
                {custom
                  ? <span>Custom range</span>
                  : <span>{periodLabel(shownFrom, shownTo)} · {periodDays(shownFrom, shownTo)} days</span>}
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((d) => (
                  <SelectItem key={d} value={String(d)}>Last {d} {d === 1 ? 'day' : 'days'}</SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom range</SelectItem>
              </SelectContent>
            </Select>
            {custom && (
              <span className="flex flex-row items-center gap-1.5">
                <input type="date" aria-label="First day" className={dateInputClass} min={rangeBounds.min} max={shownTo} value={shownFrom} onChange={(e) => onDay('from', e.target.value)} />
                <span className="text-xs text-text-tertiary">to</span>
                <input type="date" aria-label="Last day" className={dateInputClass} min={shownFrom} max={rangeBounds.max} value={shownTo} onChange={(e) => onDay('to', e.target.value)} />
              </span>
            )}
          </div>
        </Segment>
        <Segment label="Final through" last>
          <span className="text-sm font-semibold text-text-primary">
            {h ? (h.lastClosedDay ? formatDay(h.lastClosedDay) : 'No final day yet') : '…'}
            {h && h.openDays > 0 && (
              <span className="ml-1 text-[11px] font-normal text-text-tertiary">· {h.openDays} {h.openDays === 1 ? 'day' : 'days'} settling</span>
            )}
          </span>
        </Segment>
      </div>

      <div className="rounded-lg border border-border-primary bg-bg-elevated px-3.5 py-2.5 text-xs text-text-secondary">
        <strong className="text-text-primary font-semibold">Settled sessions of your suppliers</strong>
        {h ? <> · {periodLabel(h.from, h.to)}. Days are the UTC day each session started; a day is final once all its sessions settled with their money.</> : ' · loading coverage…'}
      </div>

      <Tabs value={tab} onValueChange={(next) => setParams({ tab: next })}>
        <TabsList>
          <TabsTrigger value="summary" className="gap-2"><LineChart className="h-4 w-4" /> Summary</TabsTrigger>
          <TabsTrigger value="breakdown" className="gap-2"><Layers className="h-4 w-4" /> Breakdown</TabsTrigger>
          <TabsTrigger value="sessions" className="gap-2"><ListChecks className="h-4 w-4" /> Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="pt-4">
          <SummaryTab filters={filters} onCompare={compare} initialData={firstView ? initial?.summary : undefined} />
        </TabsContent>
        <TabsContent value="breakdown" className="pt-4">
          <BreakdownTab filters={filters} dim={dim} onDim={(next) => setParams({ by: next })} period={period} />
        </TabsContent>
        <TabsContent value="sessions" className="pt-4">
          <SessionsTab filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Segment({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex flex-col justify-center gap-1 min-w-0 px-[18px] py-3 border-border-primary ${last ? '' : 'border-b md:border-b-0 md:border-r'}`}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      {children}
    </div>
  )
}
