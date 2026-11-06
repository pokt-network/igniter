import { KeyDetail } from "@/app/admin/details/KeyDetail"
import { NotificationDetail } from "@/app/admin/details/NotificationDetail"
import type { Transaction } from '@igniter/db/provider/schema'
import type { AnalyticsSessionDetailItem } from '@/app/admin/details/AnalyticsSessionDetail'

export interface TransactionDetailItem {
  type: 'transaction'
  body: Transaction
}

export type ProviderQuickDetailItem = KeyDetail | NotificationDetail | TransactionDetailItem | AnalyticsSessionDetailItem
