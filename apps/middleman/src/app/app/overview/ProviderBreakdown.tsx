'use client'

import type { PieChartItem } from '@igniter/ui/components/PieChart/PieChart'
import { Download } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useMemo, useState } from 'react'
import { GetProviderBreakdown, GetProviderCount, type ProviderBreakdownData } from '@/actions/Nodes'
import DistributionPieChart from '@igniter/ui/components/PieChart/PieChart'
import { Skeleton } from '@igniter/ui/components/skeleton'
import { toCurrencyFormat } from '@igniter/ui/lib/utils'
import { Button } from '@igniter/ui/components/button'

type SortKey = 'name' | 'suppliers' | 'stakedPokt' | 'rewards24h' | 'rewards48h'
type SortDir = 'asc' | 'desc'

const HEADER_CLASSES =
  'px-2 py-1.5 md:px-3 md:py-2 text-left text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors'
const CELL_CLASSES = 'px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm'

function buildPieData(
  providers: ProviderBreakdownData[],
  metric: keyof Pick<ProviderBreakdownData, 'suppliers' | 'stakedPokt' | 'rewards24h' | 'rewards48h'>,
): PieChartItem[] {
  const total = providers.reduce((sum, p) => sum + p[metric], 0)
  return providers.map((p) => ({
    id: p.name,
    value: p[metric],
    percent: total > 0 ? (p[metric] / total) * 100 : 0,
  }))
}

function exportToCsv(providers: ProviderBreakdownData[]) {
  const header = 'Provider,Suppliers,Staked POKT,24h Rewards,48h Rewards'
  const rows = providers.map(
    (p) =>
      `"${p.name}",${p.suppliers},${p.stakedPokt.toFixed(2)},${p.rewards24h.toFixed(2)},${p.rewards48h.toFixed(2)}`,
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

export default function ProviderBreakdown() {
  const { data: providerCount } = useQuery({
    queryKey: ['providerCount'],
    queryFn: GetProviderCount,
  })

  const { data: providers, isLoading, isError, refetch } = useQuery({
    queryKey: ['providerBreakdown'],
    queryFn: GetProviderBreakdown,
    refetchInterval: 60000,
    enabled: (providerCount ?? 0) > 1,
  })

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
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
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

  if ((providerCount ?? 0) <= 1) return null

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

      <div className="flex flex-col xl:flex-row gap-4">
        {/* Table card */}
        <div className={`${cardClasses} flex-1 min-w-0 overflow-x-auto`}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[color:--divider] bg-muted/50">
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
                    {toCurrencyFormat(p.rewards24h, 2)}
                  </td>
                  <td className={`${CELL_CLASSES} text-right font-mono`}>
                    {toCurrencyFormat(p.rewards48h, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
