'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@igniter/ui/components/tabs'

import { GetScheduleHealth } from '@/actions/Workflows'
import { SchedulesTab } from './SchedulesTab'
import WorkflowsTable from './table'

export function WorkflowsTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') === 'schedules' ? 'schedules' : 'workflows'

  const health = useQuery({
    queryKey: ['schedule-health'],
    queryFn: async () => {
      const result = await GetScheduleHealth()
      return result.data ?? []
    },
    refetchInterval: 30_000,
    initialData: [],
  })

  const alerts = health.data.filter((s) => s.state === 'unhealthy' || s.state === 'stale')
  const worst = alerts.some((s) => s.state === 'unhealthy') ? 'unhealthy' : 'stale'

  const onTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
        <TabsTrigger value="schedules">
          Schedules
          {alerts.length > 0 && (
            <span
              className={
                worst === 'unhealthy'
                  ? 'rounded-full bg-red-500/20 px-1.5 text-xs font-semibold text-red-400'
                  : 'rounded-full bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-400'
              }
            >
              {alerts.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="workflows">
        <WorkflowsTable />
      </TabsContent>
      <TabsContent value="schedules">
        <SchedulesTab health={health} />
      </TabsContent>
    </Tabs>
  )
}
