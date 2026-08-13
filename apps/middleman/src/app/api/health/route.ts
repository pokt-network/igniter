import { getDb } from '@/db'
import {sql} from "drizzle-orm";
import { getLogger } from '@igniter/logger'
import { withLogging } from '@/lib/logging/withLogging'

const log = getLogger(['middleman', 'health'])

// health check api
export const GET = withLogging(async (_: Request) => {
  const db = getDb()
  try {
    await db.execute(sql`SELECT 1`);
  } catch (e) {
    log.error('health check database connection failed', { error: e })
    return new Response(JSON.stringify({ error: 'Database connection failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({}), {
    headers: { 'Content-Type': 'application/json' },
  })
})
