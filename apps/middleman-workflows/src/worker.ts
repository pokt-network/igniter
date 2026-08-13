import { delegatorActivities, governanceActivities } from './activities'
import { importSupplierRecoveryActivities } from './activities/importSupplierRecovery'
import bootstrap from './bootstrap'
import {
  configureLogging,
  getLogger,
  Logger,
} from '@igniter/logger'
import { PocketBlockchain } from '@igniter/pocket'
import { getDb } from '@igniter/db/middleman/connection'
import schema from '@igniter/db/middleman/schema'
import {
  getWorker,
  parseWatchdogConfig,
  createDedicatedClient,
  installProcessSafetyHandlers,
  ScheduleWatchdog,
} from '@igniter/temporal'
import { buildWatchdogEntries } from '@/bootstrap'
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
      logger.warn('Failed to check bootstrap status. Retrying...', { error })
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
    logger.info('Received shutdown signal, attempting graceful shutdown...', { signal })

    const timeout = setTimeout(() => {
      logger.error('Grace period exceeded. Forcing exit.', { timeout: graceTimeoutMs })
      process.exit(1)
    }, graceTimeoutMs)

    try {
      await disconnect()
      clearTimeout(timeout)
      logger.info('Graceful shutdown complete. Exiting.')
      process.exit(0)
    } catch (err) {
      logger.error('Error during shutdown. Forcing exit.', { err })
      process.exit(1)
    }
  }

  for (const signal of signals) {
    process.on(signal, () => shutdown(signal))
  }
}

export async function setupTemporalWorker() {
  await configureLogging({ serviceName: 'middleman-workflows' })

  const dbClient = getDb<typeof schema>(logger)

  const dal = new DAL(dbClient, logger)

  await waitForAppBootstrap(dal, logger)

  // Read Pocket URLs from DB settings, seed from ENV if not yet set
  let settings = await dal.appSettings.getFirst()

  if (!settings?.pocketRpcUrl && process.env.POKT_RPC_URL) {
    logger.info('Seeding pocketRpcUrl from POKT_RPC_URL environment variable')
    await dal.appSettings.update({ pocketRpcUrl: process.env.POKT_RPC_URL })
    settings = await dal.appSettings.getFirst()
  }

  const rpcUrl = settings?.pocketRpcUrl
  const apiUrl = settings?.pocketApiUrl

  if (!rpcUrl) {
    throw new Error(
      'No Pocket RPC URL configured. Set pocketRpcUrl in application settings or provide POKT_RPC_URL environment variable.'
    )
  }

  const blockchainProvider = await PocketBlockchain.setup(rpcUrl, 'upokt', 0.001, apiUrl || undefined)

  const providerService = new ProviderService(dal.appSettings, logger)

  const shutdownGraceTime = 2500

  const { worker, disconnect } = await getWorker(logger, {
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...governanceActivities(dal),
      ...delegatorActivities(dal, blockchainProvider, providerService),
      ...importSupplierRecoveryActivities(dal, providerService),
    },
    shutdownGraceTime,
  })

  await bootstrap(logger)

  const wdConfig = parseWatchdogConfig(logger)
  const watchdogEntries = wdConfig.enabled ? buildWatchdogEntries(wdConfig) : []
  let watchdog: ScheduleWatchdog | undefined
  if (wdConfig.enabled) {
    // Fail-fast handlers belong WITH the watchdog: install only when it runs, so a
    // disabled watchdog leaves Node's default crash-on-fatal behavior intact (M2).
    installProcessSafetyHandlers(logger)
    const dedicated = await createDedicatedClient(logger)
    watchdog = new ScheduleWatchdog({
      client: dedicated,
      entries: watchdogEntries,
      store: dal.watchdog,
      config: wdConfig,
      logger: logger.getChild('ScheduleWatchdog'),
    })
    watchdog.start()
  } else {
    logger.warn('Schedule watchdog disabled (SCHEDULE_WATCHDOG_ENABLED=false)')
  }

  // The outer grace timer must cover the worker's own activity drain
  // (shutdownGraceTime) PLUS watchdog.stop() awaiting an in-flight tick (each
  // describe bounded by describeDeadlineMs) PLUS disconnect — otherwise a tick
  // stalled on describe() trips process.exit(1) and aborts the clean drain (#175).
  const outerGraceMs =
    shutdownGraceTime + (watchdog ? watchdogEntries.length * wdConfig.describeDeadlineMs + 2500 : 0)

  registerGracefulShutdown(
    async () => {
      if (watchdog) await watchdog.stop()
      await disconnect()
    },
    logger,
    outerGraceMs,
  )

  await worker.run()
}

setupTemporalWorker().then(() => {
  logger.info('Worker stopped')
  process.exit(0)
}).catch((err) => {
  logger.error('failed setting up the worker', { err })
  process.exit(1)
})
