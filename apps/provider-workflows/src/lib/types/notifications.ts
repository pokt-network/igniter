export type KeysEventMetadata = { addresses: string[]; height: number }
export type RemediationEventMetadata = { byReason: Record<string, { succeeded: string[]; failed: string[] }>; height: number }
export type DelegatorsEventMetadata = { inserted: number; updated: number; disabled: number }
export type NotificationEventMetadata = KeysEventMetadata | RemediationEventMetadata | DelegatorsEventMetadata

export interface NotificationEvent {
  type:
    | 'keys_staked'
    | 'keys_unstaked'
    | 'delegators_synced'
    | 'supplier_funds_low'
    | 'supplier_stake_low'
    | 'remediation_summary'
  summary: { title: string; body: string }
  metadata: NotificationEventMetadata
}