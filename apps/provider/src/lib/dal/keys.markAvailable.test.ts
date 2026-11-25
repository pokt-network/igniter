jest.mock('server-only', () => ({}))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// Capture the WHERE that markAvailable builds and render it, so the owner condition is checked in SQL.
let captured: SQL | undefined
jest.mock('@/db', () => ({
  getDbClient: () => ({
    db: {
      update: () => ({
        set: () => ({
          where: (where: SQL) => {
            captured = where
            return { returning: async () => [] }
          },
        }),
      }),
    },
  }),
}))

import { markAvailable } from './keys'

describe('markAvailable', () => {
  it('releases only Delivered keys delivered to this delegator AND this owner', async () => {
    await markAvailable(['pokt1a'], 'delegator-a', 'pokt1owner')
    const { sql, params } = new PgDialect().sqlToQuery(captured!)
    expect(sql).toContain('"keys"."delegator_identity" = $')
    expect(sql).toMatch(/"keys"\."owner_?[aA]ddress" = \$/)
    expect(params).toEqual(expect.arrayContaining(['pokt1a', 'delegator-a', 'pokt1owner']))
  })

  it('refuses to run without an owner', async () => {
    await expect(markAvailable(['pokt1a'], 'delegator-a', '')).rejects.toThrow('ownerAddress is required')
  })
})
