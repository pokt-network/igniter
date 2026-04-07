'use server'

import {
  type ActionResult,
  withRequireOwner,
} from '@/lib/utils/actionUtils'
import { getTemporalClient } from '@/lib/temporal'

const REMEDIATION_SCHEDULE_ID = 'SupplierRemediation-scheduled'

export async function GetRemediationScheduleStatus(): Promise<ActionResult<{ paused: boolean }>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(REMEDIATION_SCHEDULE_ID)
    const desc = await handle.describe()
    return { paused: desc.state.paused }
  })
}

export async function ToggleRemediationSchedule(paused: boolean): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(REMEDIATION_SCHEDULE_ID)
    if (paused) {
      await handle.pause()
    } else {
      await handle.unpause()
    }
  })
}

export async function TriggerRemediationSchedule(): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(REMEDIATION_SCHEDULE_ID)
    await handle.trigger()
  })
}

const ADDRESS_GROUP_MIGRATION_SCHEDULE_ID = 'SupplierAddressGroupMigration-scheduled'

export async function TriggerAddressGroupMigrationSchedule(): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const client = getTemporalClient()
    const handle = client.schedule.getHandle(ADDRESS_GROUP_MIGRATION_SCHEDULE_ID)
    await handle.trigger()
  })
}
