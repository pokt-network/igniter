import {
  Client,
  Connection,
} from '@temporalio/client'
import type { Logger } from '@igniter/logger'
import fs from 'node:fs'
import { checkEnvVariables } from '@igniter/commons/utils'
import { TemporalClient } from '@/types'

declare global {
  // eslint-disable-next-line no-var
  var temporalClient: Client
}

const getTLSConfig = (logger: Logger) => {
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

  logger.info({ crtPath, keyPath, caPath }, 'Loading TLS config for Temporal client')

  return {
    clientCertPair: {
      crt: fs.readFileSync(crtPath),
      key: fs.readFileSync(keyPath),
    },
    serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
    serverRootCACertificate: caPath ? fs.readFileSync(caPath) : undefined,
  }
}

export const getClient = async (logger: Logger): Promise<TemporalClient> => {
  if (global.temporalClient) {
    logger.debug('Using existing global Temporal client')
    return {
      client: global.temporalClient,
      disconnect: async () => {
        logger.info('Disconnecting Temporal client')
        await global.temporalClient.connection.close()
      },
    }
  }

  checkEnvVariables(['TEMPORAL_URL', 'TEMPORAL_NAMESPACE'])

  const address = process.env.TEMPORAL_URL!
  const namespace = process.env.TEMPORAL_NAMESPACE!

  logger.info({ address, namespace }, 'Connecting to Temporal...')

  const tls = getTLSConfig(logger)

  const connection = await Connection.connect({
    address,
    tls,
  })

  logger.info('Temporal connection established')

  const client = new Client({
    connection,
    namespace,
  })

  logger.info('Temporal client initialized')

  global.temporalClient = client

  return {
    client,
    disconnect: async () => {
      logger.info('Closing Temporal client connection')
      await connection.close()
    },
  }
}

/**
 * Dedicated, NON-global Temporal client for the watchdog (D6). The process
 * singleton is closed by bootstrap()'s disconnect(), so the watchdog must own
 * its own connection, created once and closed only at shutdown.
 */
export const createDedicatedClient = async (logger: Logger): Promise<TemporalClient> => {
  checkEnvVariables(['TEMPORAL_URL', 'TEMPORAL_NAMESPACE'])
  const address = process.env.TEMPORAL_URL!
  const namespace = process.env.TEMPORAL_NAMESPACE!
  const tls = getTLSConfig(logger)
  const connection = await Connection.connect({ address, tls })
  const client = new Client({ connection, namespace })
  logger.info({ address, namespace }, 'Dedicated Temporal client initialized (watchdog)')
  return {
    client,
    disconnect: async () => {
      logger.info('Closing dedicated (watchdog) Temporal connection')
      await connection.close()
    },
  }
}
