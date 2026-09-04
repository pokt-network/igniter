'use server'

import { getApplicationSettings } from '@/actions/ApplicationSettings'
import { requireAuth } from '@/lib/utils/actions'
import {
  parseDelegations,
  parseRewards,
  parseUnbonding,
  parseValidators,
  type DelegationSummary,
  type RewardSummary,
  type UnbondingEntry,
  type ValidatorSummary,
} from '@/lib/staking/parse'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'staking'])

async function apiUrl(): Promise<string> {
  const settings = await getApplicationSettings()
  if (!settings.pocketApiUrl) throw new Error('API URL not found')
  return settings.pocketApiUrl
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${await apiUrl()}${path}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed (${res.status}): ${text || 'no body'}`)
  }
  return res.json()
}

export async function GetValidators(): Promise<ValidatorSummary[]> {
  await requireAuth()
  const raw = await getJson('/cosmos/staking/v1beta1/validators?pagination.limit=500')
  return parseValidators(raw).sort((a, b) => (BigInt(b.tokens) > BigInt(a.tokens) ? 1 : -1))
}

export interface DelegatorState {
  delegations: DelegationSummary[]
  unbonding: UnbondingEntry[]
  rewards: RewardSummary[]
}

export async function GetDelegatorState(delegatorAddress: string): Promise<DelegatorState> {
  await requireAuth()
  const [delegations, unbonding, rewards] = await Promise.all([
    getJson(`/cosmos/staking/v1beta1/delegations/${delegatorAddress}?pagination.limit=500`),
    getJson(`/cosmos/staking/v1beta1/delegators/${delegatorAddress}/unbonding_delegations?pagination.limit=500`),
    getJson(`/cosmos/distribution/v1beta1/delegators/${delegatorAddress}/rewards`),
  ])
  return {
    delegations: parseDelegations(delegations),
    unbonding: parseUnbonding(unbonding),
    rewards: parseRewards(rewards),
  }
}

export interface BroadcastResult {
  hash: string
}

/**
 * Broadcasts a wallet-signed TxRaw (hex) in sync mode. Throws when the node
 * rejects it at CheckTx (non-zero code) so the caller sees the raw log.
 */
export async function BroadcastSignedTx(signedPayloadHex: string): Promise<BroadcastResult> {
  await requireAuth()
  const res = await fetch(`${await apiUrl()}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: Buffer.from(signedPayloadHex, 'hex').toString('base64'),
      mode: 'BROADCAST_MODE_SYNC',
    }),
  })
  const data: any = await res.json().catch(() => ({}))
  const txResponse = data?.tx_response
  if (!res.ok || !txResponse) {
    log.error('broadcast failed', { status: res.status, body: data })
    throw new Error(data?.message || `Broadcast failed (${res.status})`)
  }
  if (Number(txResponse.code) !== 0) {
    log.warn('broadcast rejected', { code: txResponse.code, rawLog: txResponse.raw_log })
    throw new Error(txResponse.raw_log || `Broadcast rejected with code ${txResponse.code}`)
  }
  return { hash: txResponse.txhash }
}

export type TxInclusion =
  | { status: 'pending' }
  | { status: 'success'; height: number }
  | { status: 'failure'; height: number; code: number; rawLog: string }

/** Polls tx inclusion. 404 from the gateway means "not yet indexed" → pending. */
export async function GetTxInclusion(hash: string): Promise<TxInclusion> {
  await requireAuth()
  const res = await fetch(`${await apiUrl()}/cosmos/tx/v1beta1/txs/${hash}`, { cache: 'no-store' })
  if (res.status === 404) return { status: 'pending' }
  const data: any = await res.json().catch(() => ({}))
  const txResponse = data?.tx_response
  if (!res.ok || !txResponse) {
    // Some gateways answer 400 with "tx not found" before inclusion.
    if (typeof data?.message === 'string' && /not found/i.test(data.message)) return { status: 'pending' }
    throw new Error(data?.message || `Tx lookup failed (${res.status})`)
  }
  const height = Number(txResponse.height)
  const code = Number(txResponse.code)
  if (code === 0) return { status: 'success', height }
  return { status: 'failure', height, code, rawLog: txResponse.raw_log ?? '' }
}
