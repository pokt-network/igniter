import type { TemporalConfig } from '@igniter/temporal'
import {
  getClient,
  getConfig,
} from '@igniter/temporal'
import { Duration } from '@temporalio/common'
import { Logger } from '@igniter/logger'
import Long from 'long'
import { Client } from '@temporalio/client'
import {RemediationHistoryEntryReason} from "@igniter/db/provider/enums";

enum ScheduledWorkflowType {
  SupplierStatus = 'SupplierStatus',
  SupplierRemediation = 'SupplierRemediation',
}

const ScheduledWorkflowConfig: Record<
  ScheduledWorkflowType,
  { interval: string }
> = {
  [ScheduledWorkflowType.SupplierStatus]: { interval: '2m' },
  [ScheduledWorkflowType.SupplierRemediation]: { interval: '10s' },
}

async function bootstrapNamespace(client: Client, config: TemporalConfig, logger: Logger) {
  const workflowService = client.workflowService
  const { namespace, workflowExecutionRetentionPeriod } = config

  try {
    await workflowService.describeNamespace({ namespace })
    logger.info({ namespace }, 'Namespace already exists. Skipping registration...')
  } catch (error: any) {
    if (error.details.match(/not found/i)) {
      try {
        logger.warn({ namespace }, 'Namespace does not exist. Registering...')
        await workflowService.registerNamespace({
          namespace,
          workflowExecutionRetentionPeriod: {
            seconds: Long.fromNumber(
              parseInt(workflowExecutionRetentionPeriod as string),
            ),
          },
        })
        logger.info({ namespace }, 'Namespace registered successfully, waiting 20s for it to be fully registered...')
        await new Promise((resolve) => setTimeout(resolve, 20000))
      } catch (error) {
        logger.error({ error, namespace }, 'Error registering namespace')
        throw error
      }
    } else {
      logger.error({ error, namespace }, 'Error describing namespace')
      throw error
    }
  }
}

async function bootstrapScheduledWorkflows(client: Client, config: TemporalConfig, logger: Logger) {
  for (const type of Object.values(ScheduledWorkflowType)) {
    const workflowType = type
    const { interval } = ScheduledWorkflowConfig[workflowType]

    try {
      await client.connection.workflowService.describeSchedule({
        namespace: config.namespace,
        scheduleId: `${workflowType}-scheduled`,
      })
      logger.info({ workflowType }, `Scheduled workflow already exists. Skipping registration...`)
    } catch (error: unknown) {
      try {
        logger.warn({ workflowType }, `Scheduled workflow does not exist. Registering...`)

        const defaultArgsByType: Record<ScheduledWorkflowType, any[]> = {
          [ScheduledWorkflowType.SupplierStatus]: [], // no args
          [ScheduledWorkflowType.SupplierRemediation]: [{
            // TODO: Add other default automatic remediation as we progress. Initially, we'll only support stake completion.
            reasons: [RemediationHistoryEntryReason.OwnerInitialStake, RemediationHistoryEntryReason.ServiceMismatch]
          }],
        }

        await client.schedule.create({
          action: {
            type: 'startWorkflow',
            workflowType,
            taskQueue: config.taskQueue!,
            args: defaultArgsByType[workflowType],
          },
          scheduleId: `${workflowType}-scheduled`,
          spec: {
            intervals: [{ every: interval as Duration }],
          },
        })
      } catch (error) {
        logger.error({ error, workflowType }, 'Error scheduling scheduled workflow')
        throw error
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
