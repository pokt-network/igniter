import { signPayload } from '@igniter/commons/crypto'
import { assertNotRedirect, PROVIDER_FETCH_INIT, readProviderJson } from '@igniter/commons/providerFetch'
import { Provider } from '@igniter/db/middleman/schema'
import { ProviderStatus } from '@igniter/db/middleman/enums'
import type { GovernanceRegistry } from '@igniter/commons/governance'
import ApplicationSettings from '@/lib/dal/applicationSettings'
import {
  REQUEST_IDENTITY_HEADER,
  REQUEST_SIGNATURE_HEADER,
} from '@/lib/constants'
import urlJoin from 'url-join'
import type { Logger } from '@igniter/logger'
import {
  classifyReleaseError,
  classifyReleaseResponse,
  RELEASE_LOCAL_PRE_SEND,
  RELEASE_NOT_IN_GOVERNANCE,
  type ReleaseOutcome,
} from '@/lib/provider/releaseOutcome'

/**
 * Most addresses one stake/unstaking notify request may carry. Matches the provider-side cap
 * (MAX_SUPPLIERS_PER_REQUEST in apps/provider/src/lib/models/supplier.ts), which rejects more.
 */
export const MAX_ADDRESSES_PER_NOTIFY = 1000

/**
 * Splits addresses into chunks of at most MAX_ADDRESSES_PER_NOTIFY. An empty list gives one empty
 * chunk, so the request goes out (and the provider rejects it) exactly as before chunking.
 */
function chunkAddresses(addresses: string[]): string[][] {
  if (addresses.length === 0) return [[]]
  const chunks: string[][] = []
  for (let i = 0; i < addresses.length; i += MAX_ADDRESSES_PER_NOTIFY) {
    chunks.push(addresses.slice(i, i + MAX_ADDRESSES_PER_NOTIFY))
  }
  return chunks
}

/** Upper bound for a release POST, connect included. Hitting it is an ambiguous outcome. */
export const RELEASE_TIMEOUT_MS = 20_000

/**
 * The fields of a provider row that the provider's `/api/status` reply may set: what apps/provider's
 * status route reports about its own configuration. Anything else in the reply is ignored, so a
 * provider can never write its url, identity, enabled, visible or id.
 */
export const PROVIDER_STATUS_FIELDS = [
  'regions',
  'allowedStakers',
  'minimumStake',
  'allowPublicStaking',
  'fee',
  'feeType',
  'domains',
  'addressGroups',
  'rewardAddresses',
  'returnSupplierFundsToOwner',
] as const satisfies ReadonlyArray<keyof Provider>

export type ProviderStatusUpdate =
  Pick<Provider, 'id' | 'status'> & Partial<Pick<Provider, typeof PROVIDER_STATUS_FIELDS[number]>>

function pickStatusFields(reply: Record<string, unknown>): Partial<Pick<Provider, typeof PROVIDER_STATUS_FIELDS[number]>> {
  const picked: Record<string, unknown> = {}
  for (const field of PROVIDER_STATUS_FIELDS) {
    if (field in reply) picked[field] = reply[field]
  }
  return picked
}

type ImportStatusReply = { status: string; importedSupplierAddresses?: string[]; errorMessage?: string }

export class ProviderService {

  appSettingsDal: ApplicationSettings

  logger: Logger

  governance: GovernanceRegistry

  constructor(appSettingsDal: ApplicationSettings, logger: Logger, governance: GovernanceRegistry) {
    this.appSettingsDal = appSettingsDal
    this.logger = logger
    this.governance = governance
  }

  /**
   * The base url to call for a provider: the governance source's url for its current identity,
   * never the url stored in its row. Null (and a warning) when the source does not list it; then
   * no call may go out. Throws GovernanceUnavailableError when the source cannot be read.
   */
  async governanceUrl(provider: Provider): Promise<string | null> {
    const entry = await this.governance.resolve(provider.identity)
    if (!entry) {
      this.logger.warn('Provider is not in the governance source; not calling it', { identity: provider.identity })
      return null
    }
    return entry.url
  }

  private async requireGovernanceUrl(provider: Provider): Promise<string> {
    const url = await this.governanceUrl(provider)
    if (!url) {
      throw new Error(`Provider ${provider.identity} is not in the governance source`)
    }
    return url
  }

  /**
   * Fetches the status of a single provider
   * @param provider The provider to check status for
   * @param signature
   * @param identity
   * @returns The provider status information, or null when the provider is not in the governance source
   */
  async status(provider: Provider, signature: string, identity: string): Promise<ProviderStatusUpdate | null> {
    const baseUrl = await this.governanceUrl(provider)
    if (!baseUrl) return null

    try {
      const STATUS_URL = urlJoin(baseUrl, `/api/status`)
      const status = await fetch(STATUS_URL, {
        ...PROVIDER_FETCH_INIT,
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      const { healthy, ...statusProps } = await readProviderJson(status) as Record<string, unknown>

      if (healthy) {
        return {
          ...pickStatusFields(statusProps),
          id: provider.id,
          status: ProviderStatus.Healthy,
        }
      } else {
        return {
          id: provider.id,
          status: ProviderStatus.Unhealthy,
        }
      }
    } catch (error) {
      this.logger.error('Error fetching provider status for provider', { provider, error })
      return {
        id: provider.id,
        status: ProviderStatus.Unreachable,
      }
    }
  }

  /**
   * Marks a list of addresses as staked with the provider
   * @param addresses List of addresses to mark as staked
   * @param provider
   * @returns Result of the staking operation
   */
  async markOwnerStaked(addresses: string[], provider: Provider) {
    const baseUrl = await this.requireGovernanceUrl(provider)

    // One signed request per chunk (the signature covers the body). Every chunk is sent even when
    // one fails, then the first error is thrown: the activity callers report a failure and do not
    // retry, so stopping early would leave the later chunks never sent.
    let firstError: unknown
    for (const chunk of chunkAddresses(addresses)) {
      const body = JSON.stringify({ addresses: chunk })
      const { identity, signature } = await this.signPayload(body)

      try {
        const STAKE_URL = `${baseUrl}/api/suppliers/stake`
        const operationResponse = await fetch(STAKE_URL, {
          ...PROVIDER_FETCH_INIT,
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            [REQUEST_IDENTITY_HEADER]: identity,
            [REQUEST_SIGNATURE_HEADER]: signature,
          },
        })

        assertNotRedirect(operationResponse)
        if (!operationResponse.ok) {
          throw new Error(`Error marking the suppliers as staked: ${operationResponse.statusText}`)
        }
      } catch (error) {
        this.logger.error('An error occurred while marking the suppliers as staked.', { error })
        firstError ??= error
      }
    }

    if (firstError !== undefined) throw firstError
  }

  /**
   * Marks a list of addresses as unstaking with the provider
   * @param addresses List of addresses to mark as unstaking
   * @param provider
   */
  async markOwnerUnstaking(addresses: string[], provider: Provider) {
    const baseUrl = await this.requireGovernanceUrl(provider)

    // One signed request per chunk (the signature covers the body). Every chunk is sent even when
    // one fails, then the first error is thrown: the activity callers report a failure and do not
    // retry, so stopping early would leave the later chunks never sent.
    let firstError: unknown
    for (const chunk of chunkAddresses(addresses)) {
      const body = JSON.stringify({ addresses: chunk })
      const { identity, signature } = await this.signPayload(body)

      try {
        const UNSTAKING_URL = `${baseUrl}/api/suppliers/unstaking`
        const operationResponse = await fetch(UNSTAKING_URL, {
          ...PROVIDER_FETCH_INIT,
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            [REQUEST_IDENTITY_HEADER]: identity,
            [REQUEST_SIGNATURE_HEADER]: signature,
          },
        })

        assertNotRedirect(operationResponse)
        if (!operationResponse.ok) {
          throw new Error(`Error marking the suppliers as staked: ${operationResponse.statusText}`)
        }
      } catch (error) {
        this.logger.error('An error occurred while marking the suppliers as staked.', { error })
        firstError ??= error
      }
    }

    if (firstError !== undefined) throw firstError
  }

  /**
   * Releases Delivered keys. `ownerAddress` is the failed transaction's owner (its signer): the
   * provider releases only keys it delivered to that owner for this middleman.
   */
  async releaseSuppliers(addresses: string[], provider: Provider, ownerAddress: string) {
    const baseUrl = await this.requireGovernanceUrl(provider)
    const { identity, signature } = await this.signPayload(JSON.stringify({ addresses, ownerAddress }))

    try {
      const STAKE_URL = `${baseUrl}/api/suppliers/release`
      const operationResponse = await fetch(STAKE_URL, {
        ...PROVIDER_FETCH_INIT,
        method: 'POST',
        body: JSON.stringify({ addresses, ownerAddress }),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      assertNotRedirect(operationResponse)
      if (!operationResponse.ok) {
        throw new Error(operationResponse.statusText)
      }
    } catch (error) {
      this.logger.error('An error occurred while marking the suppliers as staked.', { error })
      throw error
    }
  }

  /**
   * Same POST as `releaseSuppliers` (URL, body, signed headers), bounded by RELEASE_TIMEOUT_MS,
   * returning what it ended in instead of throwing. Never throws. Anything that fails before `fetch`
   * is invoked (reading the settings, signing the payload) provably sent nothing, so it is reported
   * as `not-sent` with code `LOCAL_PRE_SEND`; once `fetch` is invoked the outcome is classified.
   * @param addresses Supplier addresses to release
   * @param provider The provider holding the reservations
   */
  async releaseSuppliersOutcome(addresses: string[], provider: Provider, ownerAddress: string): Promise<ReleaseOutcome> {
    let releaseUrl: string
    let init: RequestInit
    try {
      const baseUrl = await this.governanceUrl(provider)
      if (!baseUrl) {
        return { kind: 'not-sent', code: RELEASE_NOT_IN_GOVERNANCE }
      }
      const body = JSON.stringify({ addresses, ownerAddress })
      const { identity, signature } = await this.signPayload(body)
      releaseUrl = `${baseUrl}/api/suppliers/release`
      init = {
        ...PROVIDER_FETCH_INIT,
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
        signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
      }
    } catch {
      return { kind: 'not-sent', code: RELEASE_LOCAL_PRE_SEND }
    }

    try {
      const operationResponse = await fetch(releaseUrl, init)
      // Only the status matters; a 3xx is not followed and classifies as ambiguous. Drop the body so
      // undici frees the connection now instead of at GC; a failure cancelling it changes nothing
      // about what the provider answered.
      try {
        await operationResponse.body?.cancel()
      } catch {
        // ignored on purpose, see above
      }

      return classifyReleaseResponse(operationResponse.status, operationResponse.statusText)
    } catch (error) {
      return classifyReleaseError(error)
    }
  }

  /**
   * Checks the status of an import supplier request with a provider.
   *
   * @param provider - The provider to check with
   * @param payload - The request payload containing ownerAddress and optional nonce
   * @param signature - The request signature
   * @param identity - The app identity
   * @returns The import status response
   */
  async checkImportStatus(
    provider: Provider,
    payload: { ownerAddress: string; nonce?: string },
    signature: string,
    identity: string,
  ): Promise<ImportStatusReply> {
    const baseUrl = await this.requireGovernanceUrl(provider)
    try {
      const STATUS_URL = urlJoin(baseUrl, '/api/import-suppliers/status')
      const response = await fetch(STATUS_URL, {
        ...PROVIDER_FETCH_INIT,
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      assertNotRedirect(response)
      if (!response.ok) {
        const errorBody = await readProviderJson(response).catch(() => ({})) as { error?: string } | null
        throw new Error(errorBody?.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const { data } = await readProviderJson(response) as { data: ImportStatusReply }
      return data
    } catch (error) {
      this.logger.error('Error checking import status with provider', {
        provider: provider.name,
        error,
      })
      throw error
    }
  }

  /**
   * Signs a given payload and returns an object containing the app's identity and the payload signature.
   *
   * @param {string} payload - The payload to be signed.
   * @return {Promise<{identity: string, signature: string}>} A promise that resolves to an object containing the app's identity and the base64-encoded signature of the payload.
   * @throws {Error} Throws an error if application settings cannot be loaded or if the payload signing fails.
   */
  async signPayload(payload: string) {
    let identity: string
    let signature: string

    try {
      const applicationSettings = await this.appSettingsDal.getFirst()
      identity = applicationSettings?.appIdentity ?? ''
    } catch (error) {
      this.logger.error('Error loading the application settings', { error })
      throw new Error('Unable to load the application settings and determine the identity of the app')
    }

    try {
      const signatureBuffer = await signPayload(payload)
      signature = signatureBuffer.toString('base64')
      return { identity, signature }
    } catch (error) {
      this.logger.error('Error signing the payload', { error })
      throw new Error('Unable to sign the payload.')
    }
  }
}
