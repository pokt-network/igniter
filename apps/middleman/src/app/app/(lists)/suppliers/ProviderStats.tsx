'use client'

import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GetUserNodes } from '@/actions/Nodes'
import { NodeStatus } from '@igniter/db/middleman/enums'
import { amountToPokt, toCompactFormat, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@igniter/ui/components/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import { ChevronRight } from 'lucide-react'
import { Skeleton } from '@igniter/ui/components/skeleton'
import { Button } from '@igniter/ui/components/button'

interface ProviderStat {
  identity: string
  name: string
  suppliers: number
  stakedPokt: number
  services: string[]
}

function computeProviderStats(
  nodes: Awaited<ReturnType<typeof GetUserNodes>>,
): ProviderStat[] {
  const map = new Map<
    string,
    { name: string; suppliers: number; stakedPokt: number; services: Set<string> }
  >()

  for (const node of nodes) {
    // Only staked nodes count as active suppliers (unstaking/unstaked excluded).
    if (node.status !== NodeStatus.Staked) continue

    const id = node.providerId ?? '__imported__'
    const name = node.provider?.name ?? 'Imported Node'

    let entry = map.get(id)
    if (!entry) {
      entry = { name, suppliers: 0, stakedPokt: 0, services: new Set() }
      map.set(id, entry)
    }

    entry.suppliers += 1
    entry.stakedPokt += amountToPokt(node.stakeAmount)

    if (node.services) {
      for (const svc of node.services) {
        entry.services.add(svc.serviceId)
      }
    }
  }

  return Array.from(map.entries())
    .map(([identity, stat]) => ({
      identity,
      name: stat.name,
      suppliers: stat.suppliers,
      stakedPokt: stat.stakedPokt,
      services: Array.from(stat.services).sort(),
    }))
    .sort((a, b) => b.suppliers - a.suppliers)
}

function ProviderCard({ stat }: { stat: ProviderStat }) {
  return (
    <div className="rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold truncate">{stat.name}</p>

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <div className="flex justify-between">
          <span>Suppliers</span>
          <span className="text-foreground font-medium">{stat.suppliers}</span>
        </div>

        <div className="flex justify-between items-center">
          <span>Staked</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-foreground font-medium cursor-default">
                {toCompactFormat(stat.stakedPokt)} POKT
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {toCurrencyFormat(stat.stakedPokt, 0)} POKT
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex justify-between items-center">
          <span>Services</span>
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-0.5 text-foreground font-medium hover:text-[color:--color-blue-1] transition-colors cursor-pointer">
                {stat.services.length}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end">
              <p className="text-sm font-semibold mb-2">Services</p>
              <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                {stat.services.map((svc) => (
                  <li key={svc} className="text-sm text-muted-foreground font-mono">
                    {svc}
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  )
}

export default function ProviderStats() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['nodes'],
    queryFn: GetUserNodes,
    refetchInterval: 60000,
  })

  const stats = useMemo(() => {
    if (!data) return []
    return computeProviderStats(data)
  }, [data])

  if (!isLoading && !isError && stats.length <= 1) return null

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Provider Stats</h3>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4 flex flex-col gap-3">
              <Skeleton className="h-4 w-24 !bg-[color:#383838]" />
              <Skeleton className="h-4 w-full !bg-[color:#383838]" />
              <Skeleton className="h-4 w-full !bg-[color:#383838]" />
              <Skeleton className="h-4 w-full !bg-[color:#383838]" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Provider Stats</h3>
        <div className="rounded-lg border border-[color:--divider] bg-[color:--main-background] base-shadow p-4 flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-sm text-muted-foreground">
            There was an error loading the provider stats.
          </p>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (stats.length <= 1) return null

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Provider Stats</h3>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}
      >
        {stats.map((stat) => (
          <ProviderCard key={stat.identity} stat={stat} />
        ))}
      </div>
    </div>
  )
}
