import fs from 'node:fs'
import type { Logger } from '@igniter/logger'

/**
 * TLS settings shared by every Temporal connection this package opens (the SDK
 * client AND the worker's NativeConnection). The worker used to connect with
 * `{ address }` only, so TEMPORAL_TLS_ENABLED secured the client while the worker
 * still spoke plaintext. Returns undefined when TEMPORAL_TLS_ENABLED !== 'true'
 * (unchanged default behaviour).
 */
export const getTLSConfig = (logger: Logger) => {
  if (process.env.TEMPORAL_TLS_ENABLED !== 'true') {
    logger.debug('TLS is disabled for Temporal connection')
    return undefined
  }

  const crtPath = process.env.TEMPORAL_CLIENT_CERT_PATH
  const keyPath = process.env.TEMPORAL_CLIENT_KEY_PATH
  const caPath = process.env.TEMPORAL_SERVER_ROOT_CA_PATH

  if (!crtPath || !keyPath) {
    logger.error('TEMPORAL_CLIENT_CERT_PATH and TEMPORAL_CLIENT_KEY_PATH are required when TLS is enabled')
    throw new Error('Missing TLS client cert/key paths')
  }

  logger.info('Loading TLS config for Temporal client', { crtPath, keyPath, caPath })

  return {
    clientCertPair: {
      crt: fs.readFileSync(crtPath),
      key: fs.readFileSync(keyPath),
    },
    serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
    serverRootCACertificate: caPath ? fs.readFileSync(caPath) : undefined,
  }
}

/**
 * Optional Temporal API key (TEMPORAL_API_KEY), sent as a bearer token by both the
 * client and the worker connection. Undefined when unset or blank, so the default
 * (no auth header) is unchanged.
 */
export const getApiKey = (): string | undefined => {
  const key = process.env.TEMPORAL_API_KEY?.trim()
  return key ? key : undefined
}
