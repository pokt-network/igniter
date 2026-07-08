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

/**
 * Drizzle's query logger receives POSITIONAL params (a bare array), so the
 * logger package's key-name-based redaction (`redactByField`) cannot see what
 * each value is — an `insert into "keys"` would emit the encrypted privateKey
 * blob verbatim. Two defenses:
 * 1. Table denylist: any query touching a secret-bearing table logs
 *    '[redacted]' instead of its params (values there are secrets by design).
 * 2. Length cap: long string params elsewhere are truncated — multi-KB
 *    blobs/hex payloads are a leak vector and add no debugging value.
 */
const SENSITIVE_TABLES_RE =
  /"(keys|notification_channels|smtp_configuration|sessions|accounts|verification_tokens?)"/i
const PARAM_MAX_LEN = 256

function safeQueryParams(query: string, params: unknown[]): unknown {
  if (SENSITIVE_TABLES_RE.test(query)) return '[redacted: sensitive table]'
  return params.map((p) =>
    typeof p === 'string' && p.length > PARAM_MAX_LEN
      ? `${p.slice(0, 64)}…[truncated ${p.length} chars]`
      : p,
  )
}

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
        logger.debug('database query', { query, params: safeQueryParams(query, params) });
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
