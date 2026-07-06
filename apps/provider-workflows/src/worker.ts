import { providerActivities } from './activities'
import {
  getLogger,
  Logger,
} from '@igniter/logger'
import {
  getWorker,
  parseWatchdogConfig,
  createDedicatedClient,
  installProcessSafetyHandlers,
  ScheduleWatchdog,
} from '@igniter/temporal'
import { getDb } from '@igniter/db/provider/connection'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import { keysTable } from '@igniter/db/provider/schema'
import { KeyState } from '@igniter/db/provider/enums'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import bootstrap from '@/bootstrap'
import { buildWatchdogEntries } from '@/bootstrap'
import { PocketBlockchain } from '@igniter/pocket'
import DAL from '@/lib/dal/DAL'

const logger = getLogger()

const BOOTSTRAP_POLL_INTERVAL = parseInt(process.env.BOOTSTRAP_POLL_INTERVAL_MS || '5000')

async function waitForAppBootstrap(dal: DAL, logger: Logger) {
  logger.info('Waiting for application to be bootstrapped...')

  while (true) {
    try {
      const bootstrapped = await dal.settings.isBootstrapped()
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

async function cleanupStaleAvailableKeys(dbClient: DBClient<typeof schema>, logger: Logger) {
  try {
    const result = await dbClient.db.update(keysTable)
      .set({
        ownerAddress: null,
        deliveredTo: null,
        deliveredAt: null,
        delegatorRevSharePercentage: 0,
        delegatorRewardsAddress: '',
      })
      .where(
        and(
          eq(keysTable.state, KeyState.Available),
          or(
            isNotNull(keysTable.ownerAddress),
            isNotNull(keysTable.deliveredTo),
          ),
        ),
      )
      .returning({ address: keysTable.address })

    if (result.length > 0) {
      logger.warn({ count: result.length }, 'Cleaned up Available keys with stale delivery data (v0.9.0 bug fix)')
    }
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup stale Available keys')
  }
}

export async function setupTemporalWorker() {
  const dbClient = getDb<typeof schema>(logger)

  const dal = new DAL(dbClient, logger)

  await waitForAppBootstrap(dal, logger)

  // One-time cleanup: fix keys left with stale delivery data from v0.9.0 bug
  // Keys in Available state should not have ownerAddress or deliveredTo set
  await cleanupStaleAvailableKeys(dbClient, logger)

  // Read Pocket URLs from DB settings, seed from ENV if not yet set
  let settings = await dal.settings.loadSettings()

  if (!settings?.pocketRpcUrl && process.env.POKT_RPC_URL) {
    logger.info('Seeding pocketRpcUrl from POKT_RPC_URL environment variable')
    await dal.settings.update({ pocketRpcUrl: process.env.POKT_RPC_URL })
    settings = await dal.settings.loadSettings()
  }

  const rpcUrl = settings?.pocketRpcUrl
  const apiUrl = settings?.pocketApiUrl

  if (!rpcUrl) {
    throw new Error(
      'No Pocket RPC URL configured. Set pocketRpcUrl in application settings or provide POKT_RPC_URL environment variable.'
    )
  }

  const blockchainProvider = await PocketBlockchain.setup(rpcUrl, 'upokt', 0.001, apiUrl || undefined)

  const shutdownGraceTime = 2500

  const { worker, disconnect } = await getWorker(logger, {
    workflowsPath: require.resolve('./workflows'),
    activities: providerActivities(dal, blockchainProvider),
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
      logger: logger.child({ context: 'ScheduleWatchdog' }),
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
  console.error(err);
  logger.error('failed setting up the worker', { err })
  process.exit(1)
})
