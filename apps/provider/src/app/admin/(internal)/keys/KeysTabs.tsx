'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@igniter/ui/components/tabs'

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

  const onTabChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="keys">Keys</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
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