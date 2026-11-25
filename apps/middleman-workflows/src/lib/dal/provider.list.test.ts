import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Logger } from '@igniter/logger'
import Provider from './provider'

// list() used a JS `&&` between two conditions, so only the second (visible) reached SQL.
// Render the filter it builds and check both columns are in it.
it('list() filters on enabled AND visible', async () => {
  const findMany = jest.fn().mockResolvedValue([])
  const dbClient = { db: { query: { providersTable: { findMany } } } }
  const dal = new Provider(dbClient as never, {} as Logger)

  await dal.list()

  const { where } = findMany.mock.calls[0][0] as { where: SQL }
  const { sql, params } = new PgDialect().sqlToQuery(where)
  expect(sql).toBe('("providers"."enabled" = $1 and "providers"."visible" = $2)')
  expect(params).toEqual([true, true])
})
