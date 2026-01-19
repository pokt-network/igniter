'use server'
import { z } from 'zod'
import { isValidPrivateKey } from '@igniter/pocket/utils'
import type { InsertKey } from '@igniter/db/provider/schema'
import { KeyState } from '@igniter/db/provider/enums'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import {
  countPrivateKeysByAddressGroup,
  insertMany,
  listKeysWithPk,
  listPrivateKeysByAddressGroup,
  updateKeysState,
  updateRewardsSettings,
  updateKeysStateWhereCurrentStateIn,
} from '@/lib/dal/keys'
import {
  type ActionResult,
  withRequireOwner,
} from '@/lib/utils/actionUtils'

export async function ListKeys() {
  return withRequireOwner(async () => {
    return listKeysWithPk()
  })
}

const KeysSchema = z.array(z.string().refine(isValidPrivateKey))

const poktAddressRegex = /^pokt1[a-z0-9]{38,43}$/

export async function ImportKeys(keys: string[], addressGroupId: number): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
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

export async function MarkKeysForRemediation(): Promise<ActionResult<void>> {
  return withRequireOwner(async () => {
    await updateKeysStateWhereCurrentStateIn([
      KeyState.AttentionNeeded,
      KeyState.RemediationFailed,
    ], KeyState.Staked)
  })
}
