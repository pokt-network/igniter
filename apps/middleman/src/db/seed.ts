import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/vercel-postgres'
import { usersTable } from '@igniter/db/middleman/schema'
import { UserRole } from '@igniter/db/middleman/enums'
import { configureLogging, getLogger } from '@igniter/logger'

async function main() {
  await configureLogging({ serviceName: 'middleman' })
  const log = getLogger(['middleman', 'seed'])

  const db = drizzle()

  const user: typeof usersTable.$inferInsert = {
    identity: 'test',
    email: 'john@example.com',
    role: UserRole.User,
  }

  await db.insert(usersTable).values(user)
  log.info('user created')

  const users = await db.select().from(usersTable)
  log.info('users fetched', { count: users.length })

  await db
    .update(usersTable)
    .set({
      email: 'johnY@example.com',
    })
    .where(eq(usersTable.email, 'john@example.com'))
  log.info('user updated')
}

main()
