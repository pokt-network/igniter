'use client'

import QuickDetailProvider, {QuickDetailRendererMap} from '@igniter/ui/components/QuickDetails/Provider'
import type { ProviderQuickDetailItem } from '@/app/admin/details/types'
import KeyDetailsCard from './KeyDetail'
import NotificationDetailCard from './NotificationDetail'
import TransactionDetail from './TransactionDetail'
import AnalyticsSessionDetail from './AnalyticsSessionDetail'

const quickDetailRenderers: QuickDetailRendererMap<ProviderQuickDetailItem> = {
  key: ({body}) => <KeyDetailsCard {...body} />,
  notification: ({body}) => <NotificationDetailCard {...body} />,
  transaction: ({body}) => <TransactionDetail tx={body} />,
  analyticsSession: ({body}) => <AnalyticsSessionDetail session={body.row} filters={body.filters} />,
}

export default function QuickDetailProviderBridge(
  { children }: { children: React.ReactNode },
) {
  return (
    <QuickDetailProvider<ProviderQuickDetailItem> renderers={quickDetailRenderers}>
      {children}
    </QuickDetailProvider>
  )
}
