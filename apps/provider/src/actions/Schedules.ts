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
