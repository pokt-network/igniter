/*
 * Who the Analytics page looks at: every one of the provider's verified suppliers (retired ones included, so their
 * history stays visible). The provider is the scope; no supplier outside its keys is ever read.
 */

export type AnalyticsKey = {
  address: string
  ownerAddress: string | null
  retiredAt: Date | null
  services: Array<{ serviceId?: string; endpoints?: Array<{ url?: string }> }> | null
}
