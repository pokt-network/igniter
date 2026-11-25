import {
  Client,
  Connection,
} from '@temporalio/client'
import type { Logger } from '@igniter/logger'
import { checkEnvVariables } from '@igniter/commons/utils'
import { TemporalClient } from '@/types'
import { getApiKey, getTLSConfig } from '@/connectionOptions'

declare global {
  // eslint-disable-next-line no-var
  var temporalClient: Client
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

  logger.info('Connecting to Temporal...', { address, namespace })

  const tls = getTLSConfig(logger)

  const connection = await Connection.connect({
    address,
    tls,
    apiKey: getApiKey(),
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
  const connection = await Connection.connect({ address, tls, apiKey: getApiKey() })
  const client = new Client({ connection, namespace })
  logger.info('Dedicated Temporal client initialized (watchdog)', { address, namespace })
  return {
    client,
    disconnect: async () => {
      logger.info('Closing dedicated (watchdog) Temporal connection')
      await connection.close()
    },
  }
}
