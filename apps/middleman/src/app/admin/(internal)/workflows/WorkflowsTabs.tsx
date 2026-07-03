'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { Tabs, TabsBadge, TabsContent, TabsList, TabsTrigger } from '@igniter/ui/components/tabs'

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
      if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to load schedule health')
      return result.data
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
          <TabsBadge count={alerts.length} variant={worst === 'unhealthy' ? 'destructive' : 'warning'} />
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
