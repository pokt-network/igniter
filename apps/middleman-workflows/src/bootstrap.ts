import { Duration } from "@temporalio/common";
import Long from "long";
import { Client } from '@temporalio/client'
import {
  getClient,
  getConfig,
  TemporalConfig,
} from '@igniter/temporal'
import { Logger } from '@igniter/logger'

enum ScheduledWorkflowType {
  GovernanceSync = 'GovernanceSync',
  ProviderStatus = "ProviderStatus",
  ExecutePendingTransaction = "ExecutePendingTransactions",
  SupplierStatus = 'SupplierStatus',
  ImportSupplierRecovery = 'ImportSupplierRecovery',
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
};

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)
  const value = match[1]!
  const unit = match[2]!
  const multipliers: Record<string, number> = {
    ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000
  }
  return parseInt(value) * multipliers[unit]!
}

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

async function bootstrapScheduledWorkflows(client: Client, config: TemporalConfig, logger: Logger) {
  for (const workflowType of Object.values(ScheduledWorkflowType)) {
    const wfConfig = ScheduledWorkflowConfig[workflowType];
    const interval = process.env[wfConfig.envVar] || wfConfig.interval;
    const scheduleId = `${workflowType}-scheduled`;

    const handle = client.schedule.getHandle(scheduleId);

    try {
      const desc = await handle.describe();

      const currentArgs = (desc as any).action.args || [];
      const currentIntervalMs = desc.spec.intervals?.[0]?.every;
      const desiredIntervalMs = parseDurationToMs(interval);

      const argsChanged = JSON.stringify(currentArgs) !== JSON.stringify(wfConfig.args);
      const intervalChanged = currentIntervalMs !== desiredIntervalMs;

      if (argsChanged || intervalChanged) {
        logger.warn(
          { workflowType, argsChanged, intervalChanged, currentIntervalMs, desiredIntervalMs },
          'Scheduled workflow config changed. Updating...'
        );
        await handle.update((prev) => ({
          ...prev,
          action: {
            ...prev.action,
            args: wfConfig.args,
          },
          spec: {
            intervals: [{ every: interval as Duration }],
          },
        }));
        logger.info({ workflowType }, 'Scheduled workflow updated successfully');
      } else {
        logger.info({ workflowType }, 'Scheduled workflow up to date. Skipping...');
      }
    } catch (error: unknown) {
      // Schedule doesn't exist, create it
      try {
        logger.warn({ workflowType }, 'Scheduled workflow does not exist. Registering...');
        await client.schedule.create({
          action: {
            type: "startWorkflow",
            workflowType,
            taskQueue: config.taskQueue!,
            args: wfConfig.args,
          },
          scheduleId,
          spec: {
            intervals: [{ every: interval as Duration }],
          },
        });
        logger.info({ workflowType, interval }, 'Scheduled workflow created successfully');
      } catch (createError: any) {
        if (createError?.code === 6 || createError?.message?.match(/already exists/i)) {
          logger.info({ workflowType }, 'Scheduled workflow already exists. Skipping registration...');
        } else {
          logger.error({ error: createError, workflowType }, 'Error scheduling scheduled workflow');
          throw createError;
        }
      }
    }
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
