'use client'

import type { PieChartItem } from '@igniter/ui/components/PieChart/PieChart'
import { Download } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GetProviderRewards, GetProviderStakes, type ProviderBreakdownData } from '@/actions/Nodes'
import DistributionPieChart from '@igniter/ui/components/PieChart/PieChart'
import { Skeleton } from '@igniter/ui/components/skeleton'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import { coverageNote, isFailedTotal } from '@igniter/ui/lib/range'
import useBlockRetry from '@igniter/ui/hooks/useBlockRetry'
import { Button } from '@igniter/ui/components/button'
import { useHeightContext } from '@igniter/ui/context/Height/height'

type SortKey = 'name' | 'suppliers' | 'stakedPokt' | 'rewards24h' | 'rewards48h'
type SortDir = 'asc' | 'desc'

const HEADER_CLASSES =
  'px-2 py-1.5 md:px-3 md:py-2 text-left text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors'
const CELL_CLASSES = 'px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm'

function buildPieData(
  providers: ProviderBreakdownData[],
  metric: keyof Pick<ProviderBreakdownData, 'suppliers' | 'stakedPokt' | 'rewards24h' | 'rewards48h'>,
): PieChartItem[] {
  // Providers whose rewards could not be fetched (null) are left out rather than drawn as 0
  const known = providers.filter((p) => p[metric] != null)
  const total = known.reduce((sum, p) => sum + (p[metric] ?? 0), 0)
  return known.map((p) => ({
    id: p.name,
    value: p[metric] ?? 0,
    percent: total > 0 ? ((p[metric] ?? 0) / total) * 100 : 0,
  }))
}

function exportToCsv(providers: ProviderBreakdownData[]) {
  const header = 'Provider,Suppliers,Staked POKT,24h Rewards,48h Rewards'
  const rows = providers.map(
    (p) =>
      `"${p.name}",${p.suppliers},${p.stakedPokt.toFixed(2)},${p.rewards24h?.toFixed(2) ?? 'N/A'},${p.rewards48h?.toFixed(2) ?? 'N/A'}`,
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `provider-breakdown-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const cardClasses = 'rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4'

export default function ProviderBreakdown({ providerCount }: { providerCount: number }) {
  const { settlementHeight, currentTime } = useHeightContext()
  // Suppliers and stake come from our database and change on any stake or unstake, so they
  // poll every 60 s (React Query pauses the interval while the tab is hidden).
  const stakes = useQuery({
    queryKey: ['providerStakes'],
    queryFn: GetProviderStakes,
    refetchInterval: 60000,
    enabled: providerCount > 1,
  })
  // Rewards only change when claims settle, so refetch on a new settlement instead of on a timer.
  // currentTime comes from the same status response as settlementHeight, so the window includes it.
  const rewards = useQuery({
    queryKey: ['providerRewards', settlementHeight],
    queryFn: () => GetProviderRewards(currentTime),
    placeholderData: keepPreviousData,
    // While hidden the status poll stops, so currentTime goes stale; the next poll after the tab
    // returns brings a new settlement height, which refetches with a fresh timestamp.
    refetchOnWindowFocus: false,
    enabled: providerCount > 1,
  })

  // Last rewards that loaded, kept on screen when a later fetch fails (an errored query for a new
  // settlement height has no data of its own).
  const lastRewardsRef = useRef(rewards.data)
  useEffect(() => {
    if (rewards.data && !rewards.isPlaceholderData) lastRewardsRef.current = rewards.data
  }, [rewards.data, rewards.isPlaceholderData])
  const rewardsData = rewards.data ?? lastRewardsRef.current
  // Some provider's batch failed on the server (its rewards came back null; in a window with
  // nothing covered, a null reward is "no data", not a failure)
  const rewardsFailed = useMemo(() => {
    if (!rewardsData) return false
    return rewardsData.providers.some((r) =>
      isFailedTotal({ data: r.rewards24h, range: rewardsData.coverage24h }) ||
      isFailedTotal({ data: r.rewards48h, range: rewardsData.coverage48h }))
  }, [rewardsData])
  // ...or a provider in the stakes poll is not in the last rewards response (it gets the inline
  // mark, and its rewards with the next settlement)
  const rewardsIncomplete = useMemo(() => {
    if (!rewardsData) return false
    const rewardIdentities = new Set(rewardsData.providers.map((r) => r.identity))
    return rewardsFailed || (stakes.data ?? []).some((p) => !rewardIdentities.has(p.identity))
  }, [rewardsData, rewardsFailed, stakes.data])

  // While the rewards are in error, retry on new blocks (capped, see useBlockRetry)
  useBlockRetry({
    key: 'rewards',
    shouldRetry: rewards.isError || rewardsFailed,
    isBusy: () => rewards.isFetching,
    run: () => void rewards.refetch(),
  })

  // Rewards missing for a provider (not loaded, failed, or absent) stay null and show as N/A.
  const providers = useMemo<ProviderBreakdownData[] | undefined>(() => {
    if (!stakes.data) return undefined
    const rewardsByIdentity = new Map((rewardsData?.providers ?? []).map((r) => [r.identity, r]))
    return stakes.data.map((p) => ({
      ...p,
      rewards24h: rewardsByIdentity.get(p.identity)?.rewards24h ?? null,
      rewards48h: rewardsByIdentity.get(p.identity)?.rewards48h ?? null,
    }))
  }, [stakes.data, rewardsData])
  const isLoading = stakes.isLoading || (rewards.isLoading && !rewardsData)
  // Only a breakdown with nothing to show is replaced by the error card; otherwise the table
  // stays, with an inline mark and N/A for what is missing.
  const isError = stakes.isError && !stakes.data
  const hasPartialError = stakes.isError || rewards.isError || rewardsIncomplete
  // The indexer covers only part of a window (new result shape only)
  const rangeNote = useMemo(() => {
    const note24h = coverageNote(rewardsData?.coverage24h ?? null)
    const note48h = coverageNote(rewardsData?.coverage48h ?? null)
    if (note24h === note48h) return note48h
    return [note24h && `24h: ${note24h}`, note48h && `48h: ${note48h}`].filter(Boolean).join('; ')
  }, [rewardsData])
  const refetch = () => Promise.all([stakes.refetch(), rewards.refetch()])

  const [rewardsPeriod, setRewardsPeriod] = useState<'24h' | '48h'>('24h')
  const [sortKey, setSortKey] = useState<SortKey>('suppliers')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sortedProviders = useMemo(() => {
    if (!providers) return []
    return [...providers].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      // Missing rewards (null) sort as the lowest value
      const aNum = (aVal as number | null) ?? -Infinity
      const bNum = (bVal as number | null) ?? -Infinity
      if (aNum === bNum) return 0
      return sortDir === 'asc' ? (aNum < bNum ? -1 : 1) : (aNum < bNum ? 1 : -1)
    })
  }, [providers, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const handleExport = useCallback(() => exportToCsv(sortedProviders), [sortedProviders])

  const stakePieData = useMemo(
    () => buildPieData(sortedProviders, 'suppliers'),
    [sortedProviders],
  )

  const rewardsPieData = useMemo(
    () =>
      buildPieData(
        sortedProviders,
        rewardsPeriod === '24h' ? 'rewards24h' : 'rewards48h',
      ),
    [sortedProviders, rewardsPeriod],
  )

  if (providerCount <= 1) return null

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48 !bg-[color:#383838]" />
        <div className="flex flex-col xl:flex-row gap-4">
          <div className={`${cardClasses} flex-1 min-w-0`}>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full !bg-[color:#383838]" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 xl:w-[420px] shrink-0">
            <div className={`${cardClasses} flex items-center justify-center py-6`}>
              <Skeleton className="h-[160px] w-[160px] rounded-full !bg-[color:#383838]" />
            </div>
            <div className={`${cardClasses} flex items-center justify-center py-6`}>
              <Skeleton className="h-[160px] w-[160px] rounded-full !bg-[color:#383838]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold">Provider Breakdown</h3>
        <div className={`${cardClasses} flex flex-col items-center justify-center py-8 gap-3`}>
          <p className="text-sm text-muted-foreground">
            There was an error loading the provider breakdown.
          </p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Provider Breakdown</h3>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          CSV
        </Button>
      </div>

      {hasPartialError && (
        <p className="text-xs text-muted-foreground">
          Some data could not be refreshed; showing the last data loaded, and N/A where there is none.
          <button type="button" onClick={() => refetch()} className="ml-2 underline">Retry</button>
        </p>
      )}
      {rangeNote && <p className="text-xs text-muted-foreground">{rangeNote}</p>}

      <div className="flex flex-col xl:flex-row gap-4">
        {/* Table card */}
        <div className={`${cardClasses} flex-1 min-w-0 overflow-x-auto`}>
          {/* Bounded scroll box: invisible until the table outgrows it, then the
              header below stays pinned. */}
          <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[color:--divider] bg-muted">
                <th className={HEADER_CLASSES} onClick={() => handleSort('name')}>
                  Provider{sortIndicator('name')}
                </th>
                <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('suppliers')}>
                  Suppliers{sortIndicator('suppliers')}
                </th>
                <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('stakedPokt')}>
                  Staked POKT{sortIndicator('stakedPokt')}
                </th>
                <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('rewards24h')}>
                  24h Rewards{sortIndicator('rewards24h')}
                </th>
                <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('rewards48h')}>
                  48h Rewards{sortIndicator('rewards48h')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProviders.map((p) => (
                <tr
                  key={p.identity}
                  className="border-b border-[color:--divider] last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className={`${CELL_CLASSES} font-medium`}>{p.name}</td>
                  <td className={`${CELL_CLASSES} text-right font-mono`}>
                    {toCurrencyFormat(p.suppliers, 0)}
                  </td>
                  <td className={`${CELL_CLASSES} text-right font-mono`}>
                    {toCurrencyFormat(p.stakedPokt, 0)}
                  </td>
                  <td className={`${CELL_CLASSES} text-right font-mono`}>
                    {p.rewards24h != null ? toCurrencyFormat(p.rewards24h, 2) : 'N/A'}
                  </td>
                  <td className={`${CELL_CLASSES} text-right font-mono`}>
                    {p.rewards48h != null ? toCurrencyFormat(p.rewards48h, 2) : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Pie charts */}
        <div className="flex flex-col gap-4 xl:w-[420px] shrink-0">
          {/* Stake Distribution card */}
          <div className={`${cardClasses} flex items-center justify-center`}>
            <DistributionPieChart
              data={stakePieData}
              label="Stake Distribution"
            />
          </div>

          {/* Rewards card */}
          <div className={`${cardClasses} flex flex-col items-center justify-center gap-2`}>
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">
                Rewards
              </p>
              <div className="flex rounded-md border border-[color:--divider] overflow-hidden text-xs">
                <button
                  onClick={() => setRewardsPeriod('24h')}
                  className={`px-2 py-0.5 transition-colors cursor-pointer ${
                    rewardsPeriod === '24h'
                      ? 'bg-[color:--color-blue-1] text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  24h
                </button>
                <button
                  onClick={() => setRewardsPeriod('48h')}
                  className={`px-2 py-0.5 transition-colors cursor-pointer ${
                    rewardsPeriod === '48h'
                      ? 'bg-[color:--color-blue-1] text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  48h
                </button>
              </div>
            </div>
            <DistributionPieChart data={rewardsPieData} />
          </div>
        </div>
      </div>
    </div>
  )
}
