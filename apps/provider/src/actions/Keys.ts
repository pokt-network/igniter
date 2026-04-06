'use server'
import { z } from 'zod'
import { isValidPrivateKey } from '@igniter/pocket/utils'
import type { InsertKey } from '@igniter/db/provider/schema'
import { KeyState } from '@igniter/db/provider/enums'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import {
  countKeys,
  countPrivateKeysByAddressGroup,
  countKeysForExport,
  getPrivateKeyById,
  insertMany,
  listDistinctOwnerAddresses,
  listKeysForExport,
  listKeysWithPk,
  listPrivateKeysByAddressGroup,
  markKeysExported,
  updateKeysState,
  updateRewardsSettings,
  updateKeysStateWhereCurrentStateIn,
  type KeyExportFilters,
} from '@/lib/dal/keys'
import {
  type ActionResult,
  withRequireOwner,
} from '@/lib/utils/actionUtils'
import { findById as findAddressGroupById } from '@/lib/dal/addressGroups'

export async function CountKeys(): Promise<ActionResult<number>> {
  return withRequireOwner(async () => countKeys())
}

export async function ListKeys() {
  return withRequireOwner(async () => {
    return listKeysWithPk()
  })
}

const KeysSchema = z.array(z.string().refine(isValidPrivateKey))

const poktAddressRegex = /^pokt1[a-z0-9]{38,43}$/

export async function ImportKeys(keys: string[], addressGroupId: number): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    if (!addressGroupId || !Number.isFinite(addressGroupId) || addressGroupId <= 0) {
      throw new Error('A valid address group must be selected before importing keys')
    }

    const group = await findAddressGroupById(addressGroupId)
    if (!group) throw new Error(`Address group ${addressGroupId} does not exist`)

    const validatedKeys = KeysSchema.parse(keys)

    const keysToInsert: Array<InsertKey> = await Promise.all(validatedKeys.map(key => {
      return DirectSecp256k1Wallet.fromKey(Buffer.from(key, 'hex'), 'pokt').then(
        (wallet) => wallet.getAccounts(),
      ).then(([account]) => {
        if (!account) {
          throw new Error('Failed to get account from key')
        }

        return {
          publicKey: Buffer.from(account.pubkey).toString('hex'),
          privateKey: key,
          address: account.address,
          addressGroupId,
          state: KeyState.Imported,
          createdAt: new Date(),
        }
      })
    }))

    await insertMany(keysToInsert)
  })
}

export async function GetKeysByAddressGroupAndState(addressGroupId: number, keyState?: KeyState) {
  return withRequireOwner(async () => {
    return listPrivateKeysByAddressGroup(addressGroupId, keyState)
  })
}

export async function CountKeysByAddressGroupAndState(addressGroupId: number, keyState?: KeyState) {
  return withRequireOwner(async () => {
    return countPrivateKeysByAddressGroup(addressGroupId, keyState)
  })
}

export async function UpdateKeyRewardsSettings(
  id: number,
  values: { delegatorRewardsAddress: string; delegatorRevSharePercentage: number },
): Promise<ActionResult<void>> {
  throw new Error('Deprecated at v0.4.4')
  return withRequireOwner(async () => {
    const schema = z.object({
      delegatorRewardsAddress: z.string().min(1).regex(poktAddressRegex, "Must be a valid POKT bech32 address"),
      delegatorRevSharePercentage: z.coerce.number().min(0).max(100),
    })

    const parsed = schema.parse(values)
    await updateRewardsSettings(id, parsed)
  })
}

export async function UpdateKeysState(ids: number[], state: KeyState): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    const schema = z.object({
      ids: z.array(z.number()),
      state: z.nativeEnum(KeyState),
    })

    const parsed = schema.parse({ ids, state })
    await updateKeysState(parsed.ids, parsed.state)
  })
}

export async function ClearKeysRemediation(): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    await updateKeysStateWhereCurrentStateIn([
      KeyState.AttentionNeeded,
      KeyState.RemediationFailed,
    ], KeyState.Staked)
  })
}

const KeyExportFiltersSchema = z.object({
  addressGroupId: z.number().int().positive().optional(),
  states: z.array(z.nativeEnum(KeyState)).optional(),
  ownerAddress: z.string().optional(),
  delegatorIdentity: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  dateField: z.enum(['createdAt', 'deliveredAt']).optional(),
  exportStatus: z.enum(['not_exported', 'previously_exported', 'all']).optional(),
})

export async function CountKeysForExport(filters: KeyExportFilters) {
  return withRequireOwner(async () => {
    const parsed = KeyExportFiltersSchema.parse(filters)
    return countKeysForExport(parsed)
  })
}

export async function ExportKeys(filters: KeyExportFilters) {
  return withRequireOwner(async () => {
    const parsed = KeyExportFiltersSchema.parse(filters)

    if (parsed.addressGroupId !== undefined) {
      const group = await findAddressGroupById(parsed.addressGroupId)
      if (!group) throw new Error(`Invalid address group id: ${parsed.addressGroupId}`)
    }

    const keys = await listKeysForExport(parsed)
    if (keys.length > 0) {
      await markKeysExported(keys.map(k => k.id))
    }
    return keys.map(k => ({ hex: k.privateKey, address: k.address }))
  })
}

export async function RevealPrivateKey(keyId: number) {
  return withRequireOwner(async () => {
    const parsed = z.number().int().positive().parse(keyId)
    const privateKey = await getPrivateKeyById(parsed)
    if (!privateKey) throw new Error('Key not found')
    return privateKey
  })
}

export async function ListDistinctOwnerAddresses() {
  return withRequireOwner(async () => {
    return listDistinctOwnerAddresses()
  })
}

export async function GenerateKeys(addressGroupId: number, count: number) {
  return withRequireOwner(async () => {
    const parsed = z.object({
      addressGroupId: z.number().int().positive(),
      count: z.number().int().min(1).max(10000),
    }).parse({ addressGroupId, count })

    const group = await findAddressGroupById(parsed.addressGroupId)
    if (!group) throw new Error(`Invalid address group id: ${parsed.addressGroupId}`)

    const { Random } = await import('@cosmjs/crypto')

    const keysToInsert: InsertKey[] = []
    const generatedKeys: { hex: string; address: string }[] = []

    for (let i = 0; i < parsed.count; i++) {
      const privateKeyBytes = Random.getBytes(32)
      const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes, 'pokt')
      const [account] = await wallet.getAccounts()

      if (!account) {
        throw new Error('Failed to create account')
      }

      const privateKeyHex = Buffer.from(privateKeyBytes).toString('hex')
      generatedKeys.push({ hex: privateKeyHex, address: account.address })

      keysToInsert.push({
        publicKey: Buffer.from(account.pubkey).toString('hex'),
        privateKey: privateKeyHex,
        address: account.address,
        addressGroupId: parsed.addressGroupId,
        state: KeyState.Available,
        createdAt: new Date(),
      })
    }

    await insertMany(keysToInsert)

    return generatedKeys
  })
}
