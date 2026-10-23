import { signPayload } from '@igniter/commons/crypto'
import { Provider } from '@igniter/db/middleman/schema'
import { ProviderStatus } from '@igniter/db/middleman/enums'
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
  type ReleaseOutcome,
} from '@/lib/provider/releaseOutcome'

/** Upper bound for a release POST, connect included. Hitting it is an ambiguous outcome. */
export const RELEASE_TIMEOUT_MS = 20_000

export class ProviderService {

  appSettingsDal: ApplicationSettings

  logger: Logger

  constructor(appSettingsDal: ApplicationSettings, logger: Logger) {
    this.appSettingsDal = appSettingsDal
    this.logger = logger
  }

  /**
   * Fetches the status of a single provider
   * @param provider The provider to check status for
   * @param signature
   * @param identity
   * @returns The provider status information
   */
  async status(provider: Provider, signature: string, identity: string) {
    try {
      const STATUS_URL = urlJoin(provider.url, `/api/status`)
      const status = await fetch(STATUS_URL, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      const { healthy, ...statusProps } = await status.json()

      if (healthy) {
        return {
          ...statusProps,
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
    const { identity, signature } = await this.signPayload(JSON.stringify({ addresses }))

    try {
      const STAKE_URL = `${provider.url}/api/suppliers/stake`
      const operationResponse = await fetch(STAKE_URL, {
        method: 'POST',
        body: JSON.stringify({ addresses }),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      if (!operationResponse.ok) {
        throw new Error(`Error marking the suppliers as staked: ${operationResponse.statusText}`)
      }
    } catch (error) {
      this.logger.error('An error occurred while marking the suppliers as staked.', { error })
      throw error
    }
  }

  /**
   * Marks a list of addresses as unstaking with the provider
   * @param addresses List of addresses to mark as unstaking
   * @param provider
   */
  async markOwnerUnstaking(addresses: string[], provider: Provider) {
    const { identity, signature } = await this.signPayload(JSON.stringify({ addresses }))

    try {
      const UNSTAKING_URL = `${provider.url}/api/suppliers/unstaking`
      const operationResponse = await fetch(UNSTAKING_URL, {
        method: 'POST',
        body: JSON.stringify({ addresses }),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      if (!operationResponse.ok) {
        throw new Error(`Error marking the suppliers as staked: ${operationResponse.statusText}`)
      }
    } catch (error) {
      this.logger.error('An error occurred while marking the suppliers as staked.', { error })
      throw error
    }
  }

  /**
   * Fetches supplier address groups from a provider for the given list of addresses
   * @param addresses List of staked node addresses
   * @param provider The provider to query
   * @returns Array of address groups with their IDs, names, and addresses
   */
  async fetchSupplierAddressGroups(addresses: string[], provider: Provider): Promise<Array<{ id: number; name: string; addresses: string[] }>> {
    const { identity, signature } = await this.signPayload(JSON.stringify({ addresses }))

    try {
      const URL = urlJoin(provider.url, '/api/suppliers/address-groups')
      const response = await fetch(URL, {
        method: 'POST',
        body: JSON.stringify({ addresses }),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      if (!response.ok) {
        throw new Error(`Error fetching supplier address groups: ${response.statusText}`)
      }

      const { data } = await response.json()
      return data.addressGroups
    } catch (error) {
      this.logger.error('An error occurred while fetching supplier address groups.', { provider: provider.name, error })
      throw error
    }
  }

  async releaseSuppliers(addresses: string[], provider: Provider) {
    const { identity, signature } = await this.signPayload(JSON.stringify({ addresses }))

    try {
      const STAKE_URL = `${provider.url}/api/suppliers/release`
      const operationResponse = await fetch(STAKE_URL, {
        method: 'POST',
        body: JSON.stringify({ addresses }),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

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
  async releaseSuppliersOutcome(addresses: string[], provider: Provider): Promise<ReleaseOutcome> {
    let releaseUrl: string
    let init: RequestInit
    try {
      const body = JSON.stringify({ addresses })
      const { identity, signature } = await this.signPayload(body)
      releaseUrl = `${provider.url}/api/suppliers/release`
      init = {
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
      // Only the status matters. Drop the body so undici frees the connection now instead of at GC;
      // a failure cancelling it changes nothing about what the provider answered.
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
  ): Promise<{ status: string; importedSupplierAddresses?: string[]; errorMessage?: string }> {
    try {
      const STATUS_URL = urlJoin(provider.url, '/api/import-suppliers/status')
      const response = await fetch(STATUS_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          [REQUEST_IDENTITY_HEADER]: identity,
          [REQUEST_SIGNATURE_HEADER]: signature,
        },
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const { data } = await response.json()
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
