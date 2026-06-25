import { KeyState, RemediationHistoryEntryReason } from '@igniter/db/provider/enums'
import type { UpsertSupplierStatusResult } from '@/activities'
import type { StatusRangeResult } from '@/workflows/SupplierStatusRange'
import type { NotificationEvent } from '@/lib/types/notifications'

/**
 * Classifies a settled batch of upsertSupplierStatus results into staked/unstaked/fundsLow/stakeLow buckets.
 */
export function classifyStatusResults(
  settled: PromiseSettledResult<UpsertSupplierStatusResult>[],
  addresses: string[],
): StatusRangeResult {
  const result: StatusRangeResult = { staked: [], unstaked: [], fundsLow: [], stakeLow: [] }

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!
    const address = addresses[i]!
    if (s.status !== 'fulfilled') continue

    const { state, remediationReasons, prev } = s.value

    if (prev?.state !== undefined) {
      const prevStateForStaked = [
        KeyState.Available, KeyState.Delivered, KeyState.Staking,
        KeyState.MissingStake, KeyState.Unstaked, KeyState.Unstaking,
      ].includes(prev.state)
      if (prevStateForStaked && state === KeyState.Staked) {
        result.staked.push(address)
      }

      const prevStateForUnstaked = [
        KeyState.Staked, KeyState.AttentionNeeded, KeyState.RemediationFailed,
      ].includes(prev.state)
      if (prevStateForUnstaked && (state === KeyState.Unstaking || state === KeyState.Unstaked)) {
        result.unstaked.push(address)
      }
    }

    if (prev?.remediationReasons !== undefined) {
      const newReasons = remediationReasons.filter((r) => !prev.remediationReasons!.includes(r))
      if (newReasons.includes(RemediationHistoryEntryReason.SupplierFundsTooLow)) {
        result.fundsLow.push(address)
      }
      if (newReasons.includes(RemediationHistoryEntryReason.SupplierStakeTooLow)) {
        result.stakeLow.push(address)
      }
    }
  }

  return result
}

/**
 * Builds the set of NotificationEvents for a StatusRangeResult. Returns only
 * events where the corresponding address list is non-empty.
 */
export function buildStatusNotificationEvents(
  result: StatusRangeResult,
  height: number,
): NotificationEvent[] {
  const n = (count: number, noun: string) => `${count} ${noun}${count !== 1 ? 's' : ''}`
  const events: NotificationEvent[] = []

  if (result.staked.length > 0) {
    events.push({
      type: 'keys_staked',
      summary: {
        title: 'Suppliers Staked',
        body: `${n(result.staked.length, 'supplier')} transitioned to Staked at block ${height}.`,
      },
      metadata: { addresses: result.staked, height },
    })
  }

  if (result.unstaked.length > 0) {
    events.push({
      type: 'keys_unstaked',
      summary: {
        title: 'Suppliers Unstaking',
        body: `${n(result.unstaked.length, 'supplier')} began unstaking at block ${height}.`,
      },
      metadata: { addresses: result.unstaked, height },
    })
  }

  if (result.fundsLow.length > 0) {
    events.push({
      type: 'supplier_funds_low',
      summary: {
        title: 'Supplier Funds Low',
        body: `${n(result.fundsLow.length, 'supplier')} have operational funds below the minimum threshold.`,
      },
      metadata: { addresses: result.fundsLow, height },
    })
  }

  if (result.stakeLow.length > 0) {
    events.push({
      type: 'supplier_stake_low',
      summary: {
        title: 'Supplier Stake Low',
        body: `${n(result.stakeLow.length, 'supplier')} have stake below the minimum threshold.`,
      },
      metadata: { addresses: result.stakeLow, height },
    })
  }

  return events
}