import {
  NativeConnection,
  Runtime,
  Worker,
  WorkerOptions,
} from '@temporalio/worker'
import { getTemporalLogger } from '@igniter/logger/temporal'
import type { Logger } from '@igniter/logger'
import { checkEnvVariables } from '@igniter/commons/utils'
import { TemporalWorker } from '@/types'

declare global {
  // eslint-disable-next-line no-var
  var temporalWorker: Worker
}

/**
 * Retrieves the address stored in the environment variable `TEMPORAL_URL`.
 *
 * This function accesses the `TEMPORAL_URL` from the process environment and returns it.
 * It assumes that the value exists and is valid, as indicated by the non-null assertion.
 *
 * @returns {string} The address specified in the `TEMPORAL_URL` environment variable.
 */
export const getAddress = () => process.env.TEMPORAL_URL!

/**
 * Retrieves the value of the `TEMPORAL_NAMESPACE` environment variable.
 * This function accesses the `process.env` object to fetch the namespace
 * used in temporal-related processes.
 *
 * @returns {string} The value of the `TEMPORAL_NAMESPACE` environment variable.
 * If the variable is not defined, this function will throw an error due to the non-null assertion.
 */
export const getNamespace = () => process.env.TEMPORAL_NAMESPACE!

/**
 * Retrieves the task queue name from the environment configuration.
 *
 * This function accesses the `TEMPORAL_TASK_QUEUE` environment variable
 * and returns its value, which represents the name of the Temporal
 * task queue being used for the application.
 *
 * @returns {string} The name of the Temporal task queue.
 * @throws {TypeError} Throws an error if the `TEMPORAL_TASK_QUEUE` is not defined.
 */
export const getTaskQueue = () => process.env.TEMPORAL_TASK_QUEUE!

/**
 * Asynchronously creates or retrieves an instance of a Temporal worker.
 *
 * This function initializes a Temporal worker and ensures only a single global instance exists.
 * If a global Temporal worker instance is already present, it reuses the existing worker.
 * Otherwise, it creates a new Temporal worker, configuring it based on the provided options and environment variables.
 *
 * @param {Logger} logger - Logger instance used for logging debug and informational messages throughout the worker lifecycle.
 * @param {Partial<WorkerOptions>} options - Configuration options for the Temporal worker, such as task queue, namespace,
 *                                           workflows, and activities. Any connection settings or worker-specific options
 *                                           should also be provided here.
 * @returns {Promise<TemporalWorker>} A promise resolving to an object containing:
 *                                    - `worker`: The Temporal worker instance.
 *                                    - `disconnect`: An asynchronous function to properly shut down the Temporal worker.
 *
 * @throws {Error} Throws an error if necessary environment variables are not defined,
 *                 or if there is an issue during the Temporal worker initialization process.
 */
export const getWorker = async (
  logger: Logger,
  options: Partial<WorkerOptions>,
): Promise<TemporalWorker> => {
  if (global.temporalWorker) {
    logger.debug('Using existing global Temporal worker')
    return {
      worker: global.temporalWorker,
      disconnect: async () => {
        logger.info('Shutting down Temporal worker...')
        return global.temporalWorker.shutdown()
      },
    }
  }

  const temporalLogger = getTemporalLogger(['temporal', 'core'])
  Runtime.install({ logger: temporalLogger })

  checkEnvVariables(['TEMPORAL_URL', 'TEMPORAL_NAMESPACE', 'TEMPORAL_TASK_QUEUE'])

  const address = getAddress()
  const namespace = getNamespace()
  const taskQueue = getTaskQueue()
  const workflowsPath = options.workflowsPath ?? require.resolve('./workflows')

  logger.info({ namespace, taskQueue, workflowsPath }, 'Initializing Temporal worker...')

  if (!options.connection) {
    options.connection = await NativeConnection.connect({ address })
  }

  const worker = await Worker.create({
    ...{
      namespace,
      taskQueue,
      workflowsPath,
      activities: options?.activities ?? {},
      bundlerOptions: {
        webpackConfigHook: (config) => {
          config.mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
          config.stats = process.env.NODE_ENV === 'production' ? 'errors-only' : 'minimal'
          return config
        },
      },
    },
    ...options,
  })

  global.temporalWorker = worker

  logger.info('Temporal worker created')

  return {
    worker,
    disconnect: async () => {
      logger.info('Shutting down Temporal worker...')
      return worker.shutdown()
    },
  }
}
