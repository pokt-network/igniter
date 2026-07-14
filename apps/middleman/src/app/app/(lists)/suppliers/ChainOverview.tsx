'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GetUserNodes } from '@/actions/Nodes'
import { NodeStatus } from '@igniter/db/middleman/enums'
import { amountToPokt, toCurrencyFormat } from '@igniter/ui/lib/utils'
import DistributionPieChart from '@igniter/ui/components/PieChart/PieChart'
import type { PieChartItem } from '@igniter/ui/components/PieChart/PieChart'
import { Button } from '@igniter/ui/components/button'
import { Download } from 'lucide-react'
import { Skeleton } from '@igniter/ui/components/skeleton'

interface ChainProviderRow {
  service: string
  provider: string
  suppliers: number
  stakedPokt: number
}

type SortKey = 'service' | 'provider' | 'suppliers' | 'stakedPokt'
type SortDir = 'asc' | 'desc'

function computeChainOverview(
  nodes: Awaited<ReturnType<typeof GetUserNodes>>,
): ChainProviderRow[] {
  const map = new Map<string, ChainProviderRow>()

  for (const node of nodes) {
    // Only staked nodes count as active suppliers (unstaking/unstaked excluded).
    if (node.status !== NodeStatus.Staked) continue

    const providerName = node.provider?.name ?? 'Imported Node'

    if (!node.services) continue

    for (const svc of node.services) {
      const key = `${svc.serviceId}::${providerName}`
      let entry = map.get(key)
      if (!entry) {
        entry = {
          service: svc.serviceId,
          provider: providerName,
          suppliers: 0,
          stakedPokt: 0,
        }
        map.set(key, entry)
      }
      entry.suppliers += 1
      entry.stakedPokt += amountToPokt(node.stakeAmount)
    }
  }

  return Array.from(map.values())
}

function buildPieData(
  rows: ChainProviderRow[],
): PieChartItem[] {
  const totals = new Map<string, number>()

  for (const row of rows) {
    totals.set(row.service, (totals.get(row.service) ?? 0) + row.suppliers)
  }

  const totalSuppliers = Array.from(totals.values()).reduce((a, b) => a + b, 0)

  return Array.from(totals.entries()).map(([id, value]) => ({
    id,
    value,
    percent: totalSuppliers > 0 ? (value / totalSuppliers) * 100 : 0,
  }))
}

const HEADER_CLASSES = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors'
const CELL_CLASSES = 'px-3 py-2 text-sm'

function exportChainOverviewCsv(rows: ChainProviderRow[]) {
  const header = 'Service,Provider,Suppliers,Staked POKT'
  const csvRows = rows.map(
    (r) => `"${r.service}","${r.provider}",${r.suppliers},${r.stakedPokt.toFixed(2)}`,
  )
  const csv = [header, ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `chain-overview-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function ChainOverview() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['nodes'],
    queryFn: GetUserNodes,
    refetchInterval: 60000,
  })

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('suppliers')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const allRows = useMemo(() => {
    if (!data) return []
    return computeChainOverview(data)
  }, [data])

  const filteredRows = useMemo(() => {
    if (!search.trim()) return allRows
    const q = search.toLowerCase()
    return allRows.filter(
      (row) =>
        row.service.toLowerCase().includes(q) ||
        row.provider.toLowerCase().includes(q),
    )
  }, [allRows, search])

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
  }, [filteredRows, sortKey, sortDir])

  const suppliersByService = useMemo(
    () => buildPieData(allRows),
    [allRows],
  )
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

  const handleExport = useCallback(() => exportChainOverviewCsv(sortedRows), [sortedRows])

  const cardClasses = 'rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4'

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Services Overview</h3>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
          <div className={`${cardClasses} min-w-0`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Search by service or provider..."
                disabled
                value=""
                className="w-full max-w-sm rounded-md border border-[color:--divider] bg-[color:--main-background] px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
              />
              <Button variant="outline" size="sm" disabled className="gap-1.5 shrink-0">
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-[color:--divider]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[color:--divider] bg-muted">
                    <th className={HEADER_CLASSES}>Service</th>
                    <th className={HEADER_CLASSES}>Provider</th>
                    <th className={`${HEADER_CLASSES} text-right`}>Suppliers</th>
                    <th className={`${HEADER_CLASSES} text-right`}>Staked POKT</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:--divider] last:border-b-0 pointer-events-none">
                      <td className={CELL_CLASSES}><Skeleton className="w-4/5 h-4 !bg-[color:#383838]" /></td>
                      <td className={CELL_CLASSES}><Skeleton className="w-3/5 h-4 !bg-[color:#383838]" /></td>
                      <td className={`${CELL_CLASSES} text-right`}><Skeleton className="w-2/5 h-4 ml-auto !bg-[color:#383838]" /></td>
                      <td className={`${CELL_CLASSES} text-right`}><Skeleton className="w-3/5 h-4 ml-auto !bg-[color:#383838]" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={`${cardClasses} flex items-center justify-center px-14`}>
            <div className="flex flex-row items-center gap-6">
              <Skeleton className="h-[220px] w-[220px] rounded-full shrink-0 !bg-[color:#383838]" />
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-5 w-[42px] rounded-sm shrink-0 !bg-[color:#383838]" />
                    <Skeleton className="h-4 w-20 !bg-[color:#383838]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Services Overview</h3>
        <div className={`${cardClasses} flex flex-col items-center justify-center py-8 gap-3`}>
          <p className="text-sm text-muted-foreground">
            There was an error loading the services overview.
          </p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Services Overview</h3>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
        {/* Table card */}
        <div className={`${cardClasses} min-w-0`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              type="text"
              placeholder="Search by service or provider..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm rounded-md border border-[color:--divider] bg-[color:--main-background] px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:--color-blue-1]"
            />
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 shrink-0">
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-[color:--divider]">
            <div className="max-h-[260px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[color:--divider] bg-muted">
                    <th className={HEADER_CLASSES} onClick={() => handleSort('service')}>
                      Service{sortIndicator('service')}
                    </th>
                    <th className={HEADER_CLASSES} onClick={() => handleSort('provider')}>
                      Provider{sortIndicator('provider')}
                    </th>
                    <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('suppliers')}>
                      Suppliers{sortIndicator('suppliers')}
                    </th>
                    <th className={`${HEADER_CLASSES} text-right`} onClick={() => handleSort('stakedPokt')}>
                      Staked POKT{sortIndicator('stakedPokt')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={`${row.service}-${row.provider}`}
                      className="border-b border-[color:--divider] last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className={`${CELL_CLASSES} font-mono`}>{row.service}</td>
                      <td className={CELL_CLASSES}>{row.provider}</td>
                      <td className={`${CELL_CLASSES} text-right font-mono`}>{row.suppliers}</td>
                      <td className={`${CELL_CLASSES} text-right font-mono`}>
                        {toCurrencyFormat(row.stakedPokt, 0)}
                      </td>
                    </tr>
                  ))}
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No results found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Pie chart */}
        <div className={`${cardClasses} flex items-center justify-center px-14`}>
          <DistributionPieChart
            data={suppliersByService}
            label="Suppliers by Service"
            legendPosition="right"
            size={220}
          />
        </div>
      </div>
    </div>
  )
}
