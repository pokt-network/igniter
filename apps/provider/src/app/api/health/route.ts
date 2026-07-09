import { getDb } from '@/db'
import { getLogger } from '@igniter/logger'

const log = getLogger(['provider', 'health'])

// health check api
export async function GET(_: Request) {
  const db = getDb()
  try {
    await db.execute('SELECT 1');
  } catch (e) {
    log.error('database health check failed', { error: e })
    return new Response(JSON.stringify({ error: 'Database connection failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({}), {
    headers: { 'Content-Type': 'application/json' },
  })
}
