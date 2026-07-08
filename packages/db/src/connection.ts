import type { Logger } from '@igniter/logger'
import type { DBClient } from './types'
import {
  Pool,
  PoolConfig,
} from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { parseEnvInt } from '@igniter/commons/utils'

type SetupOptions<TSchema> = {
  schema: TSchema;
  logger: Logger;
};

export type { DBClient }

export const setup = <TSchema extends Record<string, unknown>>(options: SetupOptions<TSchema>): DBClient<TSchema>  => {
  const {
    DATABASE_URL,
    PG_SSL_MODE = 'no-verify', // "disable" | "require" | "no-verify"
    PG_POOL_MAX,
    PG_POOL_MIN,
    PG_POOL_IDLE_TIMEOUT_MS,
    PG_POOL_CONN_TIMEOUT_MS,
  } = process.env

  const { logger, schema } = options

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable must be set.')
  }

  let ssl: PoolConfig['ssl']
  switch (PG_SSL_MODE) {
    case 'disable':
      ssl = false
      break
    case 'no-verify':
      ssl = { rejectUnauthorized: false }
      break
    case 'require':
    default:
      ssl = true
  }

  logger.info('Connecting to database', { ssl })
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl,
    max: parseEnvInt(PG_POOL_MAX, 10),
    min: parseEnvInt(PG_POOL_MIN, 0),
    idleTimeoutMillis: parseEnvInt(PG_POOL_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: parseEnvInt(PG_POOL_CONN_TIMEOUT_MS, 5000),
  })

  pool.on('error', (err) => {
    logger.error('Database pool error (connection will be retried on next query)', { error: err.message })
  })

  logger.info('Preparing database schema')
  const db = drizzle<TSchema>(pool, {
    schema,
    logger: {
      logQuery: (query: string, params: unknown[]) => {
        logger.debug('database query', { query, params });
      },
    }
  })

  return {
    db,
    disconnect: async () => {
      logger.info('Disconnecting from database')
      await pool.end()
    },
  }
}
