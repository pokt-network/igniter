'use server'

import { z } from 'zod'
import {
  type ActionResult,
  withRequireOwner,
} from '@/lib/utils/actionUtils'
import {
  listStakedKeysWithDetails,
  listKeysByAddresses,
  batchUpdateRemediationHistory,
} from '@/lib/dal/keys'
import { getExpectedServicesFromKey } from '@igniter/domain/provider/utils'
import { CompareSupplierServiceConfigHandler } from '@igniter/domain/provider/operations'
import { RemediationHistoryEntryReason } from '@igniter/db/provider/enums'
import type { RemediationHistoryEntry } from '@igniter/db/provider/schema'
import { TriggerRemediationSchedule } from '@/actions/Schedules'

interface RemediationReasonDetail {
  count: number
  addresses: string[]
  label: string
}

export interface RemediationSummary {
  total: number
  byReason: Record<string, RemediationReasonDetail>
}

export async function EvaluateRemediationNeeds(): Promise<ActionResult<RemediationSummary>> {
  return withRequireOwner(async () => {
    const keys = await listStakedKeysWithDetails()

    const comparer = new CompareSupplierServiceConfigHandler()
    const mismatchAddresses: string[] = []

    for (const key of keys) {
      // Only evaluate keys that have services synced from chain and have an address group
      if (!key.services || key.services.length === 0 || !key.addressGroup) {
        continue
      }

      const expectedServices = getExpectedServicesFromKey(key)

      if (expectedServices.length === 0) {
        continue
      }

      const result = comparer.execute({
        serviceConfigSetA: key.services,
        serviceConfigSetB: expectedServices,
      })

      if (!result.isEqual) {
        mismatchAddresses.push(key.address)
      }
    }

    const summary: RemediationSummary = {
      total: mismatchAddresses.length,
      byReason: {},
    }

    if (mismatchAddresses.length > 0) {
      summary.byReason[RemediationHistoryEntryReason.ServiceMismatch] = {
        count: mismatchAddresses.length,
        addresses: mismatchAddresses,
        label: 'Service Mismatch',
      }
    }

    return summary
  })
}

const addressesSchema = z.array(
  z.string().min(1).regex(/^pokt1[a-z0-9]{38,43}$/, 'Must be a valid POKT bech32 address'),
).min(1, 'At least one address is required')

export async function RequestRemediation(addresses: string[]): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const validatedAddresses = addressesSchema.parse(addresses)

    const keys = await listKeysByAddresses(validatedAddresses)

    if (keys.length === 0) {
      throw new Error('No keys found for the provided addresses')
    }

    const comparer = new CompareSupplierServiceConfigHandler()
    const updates: Array<{ address: string; remediationHistory: RemediationHistoryEntry[] }> = []

    for (const key of keys) {
      // Only mark keys that actually have a service mismatch
      if (!key.services || key.services.length === 0 || !key.addressGroup) {
        continue
      }

      const expectedServices = getExpectedServicesFromKey(key)
      if (expectedServices.length === 0) continue

      const comparison = comparer.execute({
        serviceConfigSetA: key.services,
        serviceConfigSetB: expectedServices,
      })

      if (comparison.isEqual) continue

      const entry: RemediationHistoryEntry = {
        message: 'Service mismatch detected — remediation requested by operator',
        reason: RemediationHistoryEntryReason.ServiceMismatch,
        timestamp: Date.now(),
      }

      const history = [...(key.remediationHistory ?? [])]
      const existingIndex = history.findIndex((item) => item.reason === entry.reason)

      if (existingIndex !== -1) {
        history[existingIndex] = entry
      } else {
        history.push(entry)
        history.sort((a, b) => b.timestamp - a.timestamp)
      }

      updates.push({
        address: key.address,
        remediationHistory: history,
      })
    }

    if (updates.length === 0) {
      return // No keys actually have mismatches
    }

    await batchUpdateRemediationHistory(updates)

    // Trigger the SupplierRemediation schedule
    await TriggerRemediationSchedule()
  })
}
