import 'server-only'
import { signPayload } from '@igniter/commons/crypto'
import { REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER } from '@igniter/commons/constants'
import { assertPoktAddress } from '@/lib/utils/address'

const REQUEST_TIMEOUT_MS = 15_000

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '')

export interface ProviderImportStatus {
  status: string
  importedSupplierAddresses?: string[]
  errorMessage?: string
}

/**
 * Asks the provider, as this middleman, for the status of one import request: the same signed
 * call middleman-workflows' importSupplierRecovery makes. `providerUrl` must come from the
 * governance source, never from the providers table.
 */
export async function getProviderImportStatus(
  providerUrl: string,
  appIdentity: string,
  payload: { ownerAddress: string; nonce: string },
): Promise<ProviderImportStatus> {
  // The signature covers the exact body that is sent.
  const body = JSON.stringify(payload)
  const signature = (await signPayload(body)).toString('base64')

  const response = await fetch(`${withoutTrailingSlash(providerUrl)}/api/import-suppliers/status`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      [REQUEST_IDENTITY_HEADER]: appIdentity,
      [REQUEST_SIGNATURE_HEADER]: signature,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`The provider did not answer the import status (HTTP ${response.status})`)
  }

  const { data } = await response.json()
  if (!data || typeof data.status !== 'string') {
    throw new Error('The provider answered the import status without a status')
  }
  return data as ProviderImportStatus
}

export interface ChainSupplier {
  ownerAddress: string
  stakeAmount: string
}

/**
 * Reads one supplier from the chain's REST api. Returns null when the chain answers that there is
 * no such supplier; throws when the chain could not be read.
 */
export async function getChainSupplier(pocketApiUrl: string, operatorAddress: string): Promise<ChainSupplier | null> {
  assertPoktAddress(operatorAddress)
  const response = await fetch(
    `${withoutTrailingSlash(pocketApiUrl)}/pokt-network/poktroll/supplier/supplier/${encodeURIComponent(operatorAddress)}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`The chain could not be read for supplier ${operatorAddress} (HTTP ${response.status})`)
  }

  const { supplier } = await response.json()
  if (!supplier || typeof supplier.owner_address !== 'string') return null
  return {
    ownerAddress: supplier.owner_address,
    stakeAmount: String(supplier.stake?.amount ?? '0'),
  }
}
