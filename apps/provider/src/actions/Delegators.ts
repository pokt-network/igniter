'use server'

import {
  disableAll,
  enableAll,
  list,
  update,
} from '@/lib/dal/delegators'
import type { Delegator } from '@igniter/db/provider/schema'
import { delegatorsTable } from '@igniter/db/provider/schema'
import { getDb } from '@/db'
import { eq } from 'drizzle-orm'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

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

export async function UpdateDelegatorsFromSource() {
  return withRequireOwnerOrAdmin(async (user) => {
    const appSettings = await getApplicationSettings()

    const delegatorsCdnUrl = process.env.DELEGATORS_CDN_URL!.replace(
      '{chainId}',
      appSettings.chainId,
    )

    if (!delegatorsCdnUrl) {
      throw new Error('DELEGATORS_CDN_URL environment variable is not defined')
    }

    console.log(`[Delegators] Starting update from ${delegatorsCdnUrl}`)

    const response = await fetch(delegatorsCdnUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch delegators: ${response.statusText}`)
    }

    type CdnDelegator = {
      name: string;
      identity: string;
      identityHistory: string[];
    };

    const delegatorsFromCdn = (await response.json()) as CdnDelegator[]
    console.log(
      `[Delegators] Fetched ${delegatorsFromCdn.length} delegators from CDN`,
    )

    const currentDelegators = await list()
    const currentDelegatorsMap = new Map(
      currentDelegators.map((d) => [d.identity, d]),
    )

    const allCdnIdentities = new Set<string>()
    for (const d of delegatorsFromCdn) {
      allCdnIdentities.add(d.identity)
      d.identityHistory.forEach((h) => allCdnIdentities.add(h))
    }

    const { inserted, updated, disabled } = await getDb().transaction(
      async (tx) => {
        let inserted = 0
        let updated = 0
        let disabled = 0

        for (const cdnDelegator of delegatorsFromCdn) {
          const possibleIds = [
            cdnDelegator.identity,
            ...cdnDelegator.identityHistory,
          ]

          const matchingCurrent =
            possibleIds.map((id) => currentDelegatorsMap.get(id)).find(Boolean) ??
            null

          if (matchingCurrent) {
            const shouldUpdateIdentity =
              matchingCurrent.identity !== cdnDelegator.identity
            const shouldUpdateName =
              matchingCurrent.name !== cdnDelegator.name

            if (shouldUpdateIdentity || shouldUpdateName) {
              await tx
                .update(delegatorsTable)
                .set({
                  identity: cdnDelegator.identity,
                  name: cdnDelegator.name,
                  updatedBy: user.identity,
                })
                .where(eq(delegatorsTable.id, matchingCurrent.id))
              updated += 1
            }
          } else {
            await tx.insert(delegatorsTable).values({
              name: cdnDelegator.name,
              identity: cdnDelegator.identity,
              createdBy: user.identity,
              updatedBy: user.identity,
              enabled: false,
            })
            inserted += 1
          }
        }

        for (const delegator of currentDelegators) {
          if (!allCdnIdentities.has(delegator.identity) && delegator.enabled) {
            await tx
              .update(delegatorsTable)
              .set({
                enabled: false,
                updatedAt: new Date(),
                updatedBy: user.identity,
              })
              .where(eq(delegatorsTable.identity, delegator.identity))
            disabled += 1
          }
        }

        return { inserted, updated, disabled }
      },
    )

    console.log(
      `[Delegators] Done. Inserted: ${inserted}, Updated: ${updated}, Disabled: ${disabled}`,
    )

    return { inserted, updated, disabled }
  })
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
