import { delegatorActivities } from './activities'
import { importSupplierRecoveryActivities } from './activities/importSupplierRecovery'
import bootstrap from './bootstrap'
import {
  getLogger,
  Logger,
} from '@igniter/logger'
import { PocketBlockchain } from '@igniter/pocket'
import { getDb } from '@igniter/db/middleman/connection'
import schema from '@igniter/db/middleman/schema'
import { getWorker } from '@igniter/temporal'
import DAL from '@/lib/dal/DAL'
import { ProviderService } from '@/lib/provider'

const logger = getLogger()

const BOOTSTRAP_POLL_INTERVAL = parseInt(process.env.BOOTSTRAP_POLL_INTERVAL_MS || '5000')

async function waitForAppBootstrap(dal: DAL, logger: Logger) {
  logger.info('Waiting for application to be bootstrapped...')

  while (true) {
    try {
      const bootstrapped = await dal.appSettings.isBootstrapped()
      if (bootstrapped) {
        logger.info('Application is bootstrapped. Proceeding with worker setup.')
        return
      }
      logger.warn('Application is not yet bootstrapped. Retrying...')
    } catch (error) {
      logger.warn({ error }, 'Failed to check bootstrap status. Retrying...')
    }
    await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_POLL_INTERVAL))
  }
}

export const registerGracefulShutdown = (
  disconnect: () => Promise<void>,
  logger: Logger,
  graceTimeoutMs = 10_000,
) => {
  let shuttingDown = false

  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR2'] as const

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn('Shutdown already in progress...')
      return
    }

    shuttingDown = true
    logger.info({ signal }, 'Received shutdown signal, attempting graceful shutdown...')

    const timeout = setTimeout(() => {
      logger.error({ timeout: graceTimeoutMs }, 'Grace period exceeded. Forcing exit.')
      process.exit(1)
    }, graceTimeoutMs)

    try {
      await disconnect()
      clearTimeout(timeout)
      logger.info('Graceful shutdown complete. Exiting.')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Error during shutdown. Forcing exit.')
      process.exit(1)
    }
  }

  for (const signal of signals) {
    process.on(signal, () => shutdown(signal))
  }
}

export async function setupTemporalWorker() {
  const POCKET_RPC = process.env.POKT_RPC_URL || ''

  if (!POCKET_RPC) {
    throw new Error('POKT_RPC_URL environment variable is not defined.')
  }

  // This will attempt to connect which will fail if the rpc is not available or the right one.
  const blockchainProvider = await PocketBlockchain.setup(POCKET_RPC)

  const dbClient = getDb<typeof schema>(logger)

  const dal = new DAL(dbClient, logger)

  const providerService = new ProviderService(dal.appSettings, logger)

  const shutdownGraceTime = 2500

  const { worker, disconnect } = await getWorker(logger, {
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...delegatorActivities(dal, blockchainProvider, providerService),
      ...importSupplierRecoveryActivities(dal, providerService),
    },
    shutdownGraceTime,
  })

  await waitForAppBootstrap(dal, logger)
  await bootstrap(logger)

  registerGracefulShutdown(disconnect, logger, shutdownGraceTime)

  await worker.run()
}

setupTemporalWorker().then(() => {
  logger.info('Worker stopped')
  process.exit(0)
}).catch((err) => {
  logger.error('failed setting up the worker', { err })
  process.exit(1)
})
