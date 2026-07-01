import Long from "long";
import { Client } from '@temporalio/client'
import type { TemporalConfig, WatchdogConfig, WatchdogEntry } from '@igniter/temporal'
import {
  ensureSchedule,
  getClient,
  getConfig,
  parseDuration,
  parseWatchdogConfig,
} from '@igniter/temporal'
import { Logger } from '@igniter/logger'

export enum ScheduledWorkflowType {
  GovernanceSync = 'GovernanceSync',
  ProviderStatus = "ProviderStatus",
  ExecutePendingTransaction = "ExecutePendingTransactions",
  SupplierStatus = 'SupplierStatus',
  ImportSupplierRecovery = 'ImportSupplierRecovery',
  VerifyPendingTransactions = 'VerifyPendingTransactions',
}

const ScheduledWorkflowConfig: Record<
  ScheduledWorkflowType,
  { interval: string; args: any[]; envVar: string }
> = {
  [ScheduledWorkflowType.GovernanceSync]: {
    interval: '5m',
    args: [],
    envVar: 'SCHEDULE_GOVERNANCE_SYNC_INTERVAL',
  },
  [ScheduledWorkflowType.ProviderStatus]: {
    interval: "1m",
    args: [],
    envVar: 'SCHEDULE_PROVIDER_STATUS_INTERVAL',
  },
  [ScheduledWorkflowType.ExecutePendingTransaction]: {
    interval: "10s",
    args: [],
    envVar: 'SCHEDULE_EXECUTE_PENDING_TX_INTERVAL',
  },
  [ScheduledWorkflowType.SupplierStatus]: {
    interval: '2m',
    args: [],
    envVar: 'SCHEDULE_SUPPLIER_STATUS_INTERVAL',
  },
  [ScheduledWorkflowType.ImportSupplierRecovery]: {
    interval: '1m',
    args: [],
    envVar: 'SCHEDULE_IMPORT_SUPPLIER_RECOVERY_INTERVAL',
  },
  [ScheduledWorkflowType.VerifyPendingTransactions]: {
    interval: '30s',
    args: [],
    envVar: 'SCHEDULE_VERIFY_PENDING_TX_INTERVAL',
  },
};

async function bootstrapNamespace(client: Client, config: TemporalConfig, logger: Logger) {
  const workflowService = client.workflowService;
  const { namespace, workflowExecutionRetentionPeriod } = config;

  try {
    await workflowService.describeNamespace({ namespace });
    logger.info({ namespace }, 'Namespace already exists. Skipping registration...')
  } catch (error: any) {
    if (error.details.match(/not found/i)) {
      try {
        logger.warn({ namespace }, 'Namespace does not exist. Registering...')
        await workflowService.registerNamespace({
          namespace,
          workflowExecutionRetentionPeriod: {
            seconds: Long.fromNumber(
              parseInt(workflowExecutionRetentionPeriod as string)
            ),
          },
        });
        logger.info({ namespace }, 'Namespace registered successfully, waiting 20s for it to be fully registered...')
        await new Promise((resolve) => setTimeout(resolve, 20000));
      } catch (error) {
        logger.error({ error, namespace }, 'Error registering namespace')
        throw error;
      }
    } else {
      logger.error({ error, namespace }, 'Error describing namespace')
      throw error;
    }
  }
}

export function buildWatchdogEntries(config: WatchdogConfig, logger?: Logger): WatchdogEntry[] {
  const { taskQueue } = getConfig()
  return Object.values(ScheduledWorkflowType).map((wt) => {
    const wf = ScheduledWorkflowConfig[wt]
    const interval = process.env[wf.envVar] || wf.interval
    const parsed = parseDuration(interval)
    if (parsed == null) {
      logger?.warn(
        { scheduleId: `${wt}-scheduled`, envVar: wf.envVar, raw: interval, fallback: wf.interval },
        'Invalid schedule interval override; falling back to default',
      )
    }
    const intervalMs = parsed ?? parseDuration(wf.interval)!
    return {
      scheduleId: `${wt}-scheduled`,
      workflowType: wt, // middleman: the enum value IS the workflow type
      taskQueue,
      args: wf.args,
      interval,
      intervalMs,
      missedFirings: config.missedFirings,
      minAgeMs: config.minAgeMs,
      minGraceMs: config.minGraceMs,
      graceCapMs: config.graceCapMs,
    }
  })
}

async function bootstrapScheduledWorkflows(client: Client, _config: TemporalConfig, logger: Logger) {
  const wdConfig = parseWatchdogConfig(logger)
  for (const entry of buildWatchdogEntries(wdConfig, logger)) {
    await ensureSchedule(client, entry, logger)
  }
}

export default async function bootstrap(logger: Logger) {
  logger.info('Starting bootstrap...')
  const { client, disconnect } = await getClient(logger)
  const config = getConfig()
  await bootstrapNamespace(client, config, logger)
  await bootstrapScheduledWorkflows(client, config, logger)
  logger.info('Bootstrap completed')
  await disconnect()
}
