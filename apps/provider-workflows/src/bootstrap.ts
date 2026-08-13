import type { TemporalConfig, WatchdogConfig, WatchdogEntry } from '@igniter/temporal'
import {
  ensureSchedule,
  getClient,
  getConfig,
  parseDuration,
  parseWatchdogConfig,
} from '@igniter/temporal'
import { Logger } from '@igniter/logger'
import Long from 'long'
import { Client } from '@temporalio/client'
import { RemediationHistoryEntryReason } from "@igniter/db/provider/enums"

export enum ScheduledWorkflowType {
  GovernanceSync = 'GovernanceSync',
  SupplierStatus = 'SupplierStatus',
  SupplierRemediation = 'SupplierRemediation',
  SupplierInitialStake = 'SupplierInitialStake',
  SupplierAddressGroupMigration = 'SupplierAddressGroupMigration',
  VerifyPendingTransactions = 'VerifyPendingTransactions',
  ExecutePendingTransactions = 'ExecutePendingTransactions',
}

const ScheduledWorkflowConfig: Record<
  ScheduledWorkflowType,
  { workflowType: string; interval: string; args: any[]; envVar: string }
> = {
  [ScheduledWorkflowType.GovernanceSync]: {
    workflowType: 'GovernanceSync',
    interval: '5m',
    args: [],
    envVar: 'SCHEDULE_GOVERNANCE_SYNC_INTERVAL',
  },
  [ScheduledWorkflowType.SupplierStatus]: {
    workflowType: 'SupplierStatus',
    interval: '2m',
    args: [],
    envVar: 'SCHEDULE_SUPPLIER_STATUS_INTERVAL',
  },
  [ScheduledWorkflowType.SupplierRemediation]: {
    workflowType: 'SupplierRemediation',
    interval: '10s',
    args: [{
      reasons: [RemediationHistoryEntryReason.ServiceMismatch]
    }],
    envVar: 'SCHEDULE_SUPPLIER_REMEDIATION_INTERVAL',
  },
  [ScheduledWorkflowType.SupplierInitialStake]: {
    workflowType: 'SupplierRemediation',
    interval: '10s',
    args: [{
      reasons: [RemediationHistoryEntryReason.OwnerInitialStake]
    }],
    envVar: 'SCHEDULE_SUPPLIER_INITIAL_STAKE_INTERVAL',
  },
  [ScheduledWorkflowType.SupplierAddressGroupMigration]: {
    workflowType: 'SupplierRemediation',
    interval: '30s',
    args: [{
      reasons: [RemediationHistoryEntryReason.AddressGroupMigration]
    }],
    envVar: 'SCHEDULE_SUPPLIER_ADDRESS_GROUP_MIGRATION_INTERVAL',
  },
  [ScheduledWorkflowType.VerifyPendingTransactions]: {
    workflowType: 'VerifyPendingTransactions',
    interval: '30s',
    args: [],
    envVar: 'SCHEDULE_VERIFY_PENDING_TX_INTERVAL',
  },
  [ScheduledWorkflowType.ExecutePendingTransactions]: {
    workflowType: 'ExecutePendingTransactions',
    interval: '10s',
    args: [],
    envVar: 'SCHEDULE_EXECUTE_PENDING_TX_INTERVAL',
  },
}

async function bootstrapNamespace(client: Client, config: TemporalConfig, logger: Logger) {
  const workflowService = client.workflowService
  const { namespace, workflowExecutionRetentionPeriod } = config

  try {
    await workflowService.describeNamespace({ namespace })
    logger.info('Namespace already exists. Skipping registration...', { namespace })
  } catch (error: any) {
    if (error.details.match(/not found/i)) {
      try {
        logger.warn('Namespace does not exist. Registering...', { namespace })
        await workflowService.registerNamespace({
          namespace,
          workflowExecutionRetentionPeriod: {
            seconds: Long.fromNumber(
              parseInt(workflowExecutionRetentionPeriod as string),
            ),
          },
        })
        logger.info('Namespace registered successfully, waiting 20s for it to be fully registered...', { namespace })
        await new Promise((resolve) => setTimeout(resolve, 20000))
      } catch (error) {
        logger.error('Error registering namespace', { error, namespace })
        throw error
      }
    } else {
      logger.error('Error describing namespace', { error, namespace })
      throw error
    }
  }
}

export function buildWatchdogEntries(config: WatchdogConfig, logger?: Logger): WatchdogEntry[] {
  const { taskQueue } = getConfig()
  return Object.values(ScheduledWorkflowType).map((wt) => {
    const wf = ScheduledWorkflowConfig[wt]
    const rawOverride = process.env[wf.envVar] || wf.interval
    const parsed = parseDuration(rawOverride)
    if (parsed == null) {
      logger?.warn(
        'Invalid schedule interval override; falling back to default',
        { scheduleId: `${wt}-scheduled`, envVar: wf.envVar, raw: rawOverride, fallback: wf.interval },
      )
    }
    // Never carry an invalid override forward: fall the STRING back to the default
    // too, so `interval` and `intervalMs` can never disagree (M3/#114). The spec is
    // armed from intervalMs, so an unparseable raw string never reaches the SDK.
    const interval = parsed == null ? wf.interval : rawOverride
    const intervalMs = parsed ?? parseDuration(wf.interval)!
    return {
      scheduleId: `${wt}-scheduled`,
      workflowType: wf.workflowType,
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
