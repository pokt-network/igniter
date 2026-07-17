'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { Tabs, TabsContent, TabsList, TabsTrigger, TabsBadge } from '@igniter/ui/components/tabs'

import { GetKeysPendingState } from '@/actions/Transactions'
import KeysTable from '@/app/admin/(internal)/keys/table'
import ActivitiesSection from '@/app/admin/(internal)/keys/ActivitiesSection'

const TABS = ['keys', 'activity'] as const
type TabValue = (typeof TABS)[number]

// The two data tables that used to stack on the Keys screen now live one per
// tab. Selection is persisted in the URL (?tab=) so refreshes / deep-links land
// on the same table — same pattern as the middleman Suppliers screen.
export default function KeysTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const param = searchParams.get('tab')
  const tab: TabValue = (TABS as readonly string[]).includes(param ?? '')
    ? (param as TabValue)
    : 'keys'

  // Lifted above the tab boundary so the pending count stays live regardless of
  // the active tab — ActivitiesSection (its own consumer of this same queryKey)
  // only mounts on the Activity tab, so the badge needs its own always-mounted
  // read. Same queryKey → react-query dedups to a single poll + shared cache.
  const { data: pendingState } = useQuery({
    queryKey: ['keys-pending-state'],
    queryFn: async () => {
      const res = await GetKeysPendingState()
      return res.success ? res.data : { byKey: {}, pendingOperations: [] }
    },
    refetchInterval: 4000,
  })
  const pendingCount = Object.keys(pendingState?.byKey ?? {}).length

  const onTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="keys">Keys</TabsTrigger>
        <TabsTrigger value="activity">
          Activity
          <TabsBadge count={pendingCount} variant="warning" />
        </TabsTrigger>
      </TabsList>
      <TabsContent value="keys">
        <KeysTable />
      </TabsContent>
      <TabsContent value="activity">
        <ActivitiesSection />
      </TabsContent>
    </Tabs>
  )
}