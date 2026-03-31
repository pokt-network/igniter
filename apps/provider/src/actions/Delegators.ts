'use server'

import {
  countDelegators,
  disableAll,
  enableAll,
  list,
  listAll,
  applyGovernanceSync,
  update,
} from '@/lib/dal/delegators'
import type { Delegator } from '@igniter/db/provider/schema'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'

export async function CountDelegators() {
  return withRequireOwnerOrAdmin(async () => countDelegators())
}

export async function ListDelegators() {
  return withRequireOwnerOrAdmin(async () => {
    return list()
  })
}

export async function UpdateDelegator(identity: string, updateValues: Pick<Delegator, 'enabled'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    return update(identity, {
      ...updateValues,
      updatedBy: user.identity,
    })
  })
}

const GOVERNANCE_SYNC_SCHEDULE_ID = 'GovernanceSync-scheduled'

export async function TriggerGovernanceSync() {
  return withRequireOwnerOrAdmin(async () => {
    const { getTemporalClient } = await import('@/lib/temporal')
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(GOVERNANCE_SYNC_SCHEDULE_ID)
    await handle.trigger()
  })
}

type CdnDelegator = { name: string; identity: string; identityHistory: string[] }

// This is here because when doing the setup, the provider workflows can not start running because the app is not bootstrapped
// so we cannot call TriggerGovernanceSync at setup time
export async function SyncDelegatorsFromGovernance() {
  return withRequireOwnerOrAdmin(async (user) => {
    const cdnUrlTemplate = process.env.DELEGATORS_CDN_URL
    if (!cdnUrlTemplate) {
      throw new Error('DELEGATORS_CDN_URL environment variable is not defined')
    }

    const settings = await getApplicationSettings()
    const cdnUrl = cdnUrlTemplate.replace('{chainId}', settings.chainId.replace('lego-testnet', 'beta'))

    const response = await fetch(cdnUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch delegators from CDN: ${response.statusText}`)
    }

    const cdnDelegators = (await response.json()) as CdnDelegator[]
    const current = await listAll()
    const currentMap = new Map(current.map((d: Delegator) => [d.identity, d]))

    const allCdnIdentities = new Set<string>()
    for (const d of cdnDelegators) {
      allCdnIdentities.add(d.identity)
      d.identityHistory.forEach((h) => allCdnIdentities.add(h))
    }

    const toInsert: { name: string; identity: string }[] = []
    const toUpdate: { id: number; name: string; identity: string }[] = []
    const toDisable: { identity: string }[] = []

    for (const cdnDelegator of cdnDelegators) {
      const possibleIds = [cdnDelegator.identity, ...cdnDelegator.identityHistory]
      const matchingCurrent: Delegator | null =
        possibleIds.map((id) => currentMap.get(id)).find((d): d is Delegator => d != null) ?? null

      if (matchingCurrent) {
        if (matchingCurrent.identity !== cdnDelegator.identity || matchingCurrent.name !== cdnDelegator.name) {
          toUpdate.push({ id: matchingCurrent.id, identity: cdnDelegator.identity, name: cdnDelegator.name })
        }
      } else {
        toInsert.push({ identity: cdnDelegator.identity, name: cdnDelegator.name })
      }
    }

    for (const delegator of current) {
      if (!allCdnIdentities.has(delegator.identity) && delegator.enabled) {
        toDisable.push({ identity: delegator.identity })
      }
    }

    await applyGovernanceSync(toInsert, toUpdate, toDisable, user.identity)
  })
}

/** @deprecated Use TriggerGovernanceSync instead — kept for bootstrap compatibility */
export async function UpdateDelegatorsFromSource() {
  return TriggerGovernanceSync()
}

export async function DisableAllDelegators() {
  return withRequireOwnerOrAdmin(async (user) => {
    return disableAll(user.identity)
  })
}

export async function EnableAllDelegators() {
  return withRequireOwnerOrAdmin(async (user) => {
    return enableAll(user.identity)
  })
}
