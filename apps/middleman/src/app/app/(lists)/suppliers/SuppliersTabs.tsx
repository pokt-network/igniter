'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { Tabs, TabsContent, TabsList, TabsTrigger, TabsBadge } from '@igniter/ui/components/tabs'

import { GetPendingState } from '@/actions/Pending'
import NodesTable from '@/app/app/(lists)/suppliers/table'
import ActivitiesSection from '@/app/app/(lists)/suppliers/ActivitiesSection'
import ChainOverview from '@/app/app/(lists)/suppliers/ChainOverview'

const TABS = ['suppliers', 'activity', 'overview'] as const
type TabValue = (typeof TABS)[number]

// The three data tables that used to stack on the Suppliers screen now live one
// per tab. Selection is persisted in the URL (?tab=) so refreshes / deep-links
// land on the same table — same pattern as WorkflowsTabs.
export default function SuppliersTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const param = searchParams.get('tab')
  const tab: TabValue = (TABS as readonly string[]).includes(param ?? '')
    ? (param as TabValue)
    : 'suppliers'

  // Lifted above the tab boundary so the pending count stays live regardless of
  // the active tab — ActivitiesSection (its own consumer of this same queryKey)
  // only mounts on the Activity tab, so the badge needs its own always-mounted
  // read. Same queryKey → react-query dedups to a single poll + shared cache.
  const { data: pendingState } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => ((q.state.data?.pendingOperations?.length ?? 0) > 0 ? 7000 : false),
  })
  const pendingCount = Object.keys(pendingState?.byOperator ?? {}).length

  const onTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        <TabsTrigger value="activity">
          Activity
          <TabsBadge count={pendingCount} variant="warning" />
        </TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
      </TabsList>
      <TabsContent value="suppliers">
        <NodesTable />
      </TabsContent>
      <TabsContent value="activity">
        <ActivitiesSection />
      </TabsContent>
      <TabsContent value="overview">
        <ChainOverview />
      </TabsContent>
    </Tabs>
  )
}