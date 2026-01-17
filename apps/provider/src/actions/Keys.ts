'use server'
import { z } from 'zod'
import { isValidPrivateKey } from '@igniter/pocket/utils'
import { getCurrentUserIdentity } from '@/lib/utils/actions'
import type { InsertKey } from '@igniter/db/provider/schema'
import { KeyState } from '@igniter/db/provider/enums'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import {
  countPrivateKeysByAddressGroup,
  insertMany,
  listKeysWithPk,
  listPrivateKeysByAddressGroup, updateKeysState,
  updateRewardsSettings,
  updateKeysStateWhereCurrentStateIn,
} from '@/lib/dal/keys'
import { GetApplicationSettings } from '@/actions/ApplicationSettings'

export async function ListKeys() {
  await validateUserSignedInIsTheOwner()
  return listKeysWithPk()
}

const KeysSchema = z.array(z.string().refine(isValidPrivateKey))

export async function ImportKeys(keys: string[], addressGroupId: number) {
  await validateUserSignedInIsTheOwner()

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
        // once they
        state: KeyState.Imported,
        createdAt: new Date(),
      }
    })
  }))

  await insertMany(keysToInsert)
}

export async function GetKeysByAddressGroupAndState(addressGroupId: number, keyState?: KeyState) {
  await validateUserSignedInIsTheOwner()
  return listPrivateKeysByAddressGroup(addressGroupId, keyState)
}

export async function CountKeysByAddressGroupAndState(addressGroupId: number, keyState?: KeyState) {
  await validateUserSignedInIsTheOwner()
  return countPrivateKeysByAddressGroup(addressGroupId, keyState)
}

const poktAddressRegex = /^pokt[a-zA-Z0-9]{39,42}$/

export async function UpdateKeyRewardsSettings(
  id: number,
  values: { delegatorRewardsAddress: string; delegatorRevSharePercentage: number },
) {
  await validateUserSignedInIsTheOwner()

  const schema = z.object({
    delegatorRewardsAddress: z.string().min(1).regex(poktAddressRegex, "Must be a valid Cosmos address with 'pokt' prefix"),
    delegatorRevSharePercentage: z.coerce.number().min(0).max(100),
  })

  const parsed = schema.parse(values)

  await updateRewardsSettings(id, parsed)
}

export async function UpdateKeysState(ids: number[], state: KeyState) {
  await validateUserSignedInIsTheOwner()

  const schema = z.object({
    ids: z.array(z.number()),
    state: z.nativeEnum(KeyState),
  })

  const parsed = schema.parse({ ids, state })

  await updateKeysState(parsed.ids, parsed.state)
}

export async function validateUserSignedInIsTheOwner() {
  console.log('[KEYS:validateOwner] Called');

  const [identity, appSettings] = await Promise.all([
    getCurrentUserIdentity(),
    GetApplicationSettings(),
  ])

  console.log('[KEYS:validateOwner] Comparison', {
    identity,
    ownerIdentity: appSettings.ownerIdentity,
    match: identity === appSettings.ownerIdentity,
    identityType: typeof identity,
    ownerIdentityType: typeof appSettings.ownerIdentity,
  });

  if (identity !== appSettings.ownerIdentity) {
    console.log('[KEYS:validateOwner] MISMATCH - throwing Unauthorized');
    throw new Error('Unauthorized')
  }

  console.log('[KEYS:validateOwner] MATCH - authorized');
}

export async function MarkKeysForRemediation() {
  await validateUserSignedInIsTheOwner()
  await updateKeysStateWhereCurrentStateIn([
    KeyState.AttentionNeeded,
    KeyState.RemediationFailed,
  ], KeyState.Staked)
}
