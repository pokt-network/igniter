import { KeyDetail } from "@/app/admin/details/KeyDetail"
import { NotificationDetail } from "@/app/admin/details/NotificationDetail"
import type { Transaction } from '@igniter/db/provider/schema'

export interface TransactionDetailItem {
  type: 'transaction'
  body: Transaction
}

export type ProviderQuickDetailItem = KeyDetail | NotificationDetail | TransactionDetailItem
