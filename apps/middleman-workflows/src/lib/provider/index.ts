import { signPayload } from '@/lib/crypto'
import { Provider } from '@igniter/db/middleman/schema'
import { ProviderStatus } from '@igniter/db/middleman/enums'
import ApplicationSettings from '@/lib/dal/applicationSettings'
import {
  REQUEST_IDENTITY_HEADER,
  REQUEST_SIGNATURE_HEADER,
} from '@/lib/constants'
import urlJoin from 'url-join'
import type { Logger } from '@igniter/logger'

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
      this.logger.error('Error fetching provider status', { error })
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
