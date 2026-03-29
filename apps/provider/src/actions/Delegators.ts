'use server'

import {
  countDelegators,
  disableAll,
  enableAll,
  list,
  update,
} from '@/lib/dal/delegators'
import type { Delegator } from '@igniter/db/provider/schema'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

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
