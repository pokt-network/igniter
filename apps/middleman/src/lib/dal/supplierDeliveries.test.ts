jest.mock('server-only', () => ({}))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

// A fake db: select returns `rows` and keeps the WHERE so its SQL can be checked.
let rows: Array<{ id: number; ownerAddress: string; addresses: string[] }> = []
let where: SQL | undefined
const inserted: unknown[] = []
jest.mock('@/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async (w: SQL) => { where = w; return rows } }) }),
    insert: () => ({ values: async (v: unknown) => { inserted.push(v) } }),
  }),
}))

import { claimRelease, recordDelivery, DELIVERY_RELEASE_WINDOW_MS } from './supplierDeliveries'

beforeEach(() => { rows = []; where = undefined; inserted.length = 0 })

describe('claimRelease', () => {
  it("looks only at this user's unexpired, unreleased deliveries from this provider", async () => {
    const now = new Date('2026-01-15T12:00:00Z')
    await claimRelease('pokt1user', 'pokt1provider', ['pokt1a'], now)
    const { sql, params } = new PgDialect().sqlToQuery(where!)
    expect(sql).toContain('"supplier_deliveries"."userIdentity" = $')
    expect(sql).toContain('"supplier_deliveries"."providerIdentity" = $')
    expect(sql).toContain('"supplier_deliveries"."releasedAt" is null')
    expect(sql).toContain('"supplier_deliveries"."expiresAt" > $')
    expect(params).toEqual(expect.arrayContaining(['pokt1user', 'pokt1provider']))
  })

  it('keeps only the requested addresses that a delivery covers, with the recorded owner', async () => {
    rows = [{ id: 1, ownerAddress: 'pokt1owner', addresses: ['pokt1a', 'pokt1b'] }]
    await expect(claimRelease('pokt1user', 'pokt1provider', ['pokt1a', 'pokt1foreign'])).resolves.toEqual({
      kind: 'ok', deliveryIds: [1], ownerAddress: 'pokt1owner', addresses: ['pokt1a'],
    })
  })

  it('returns none when no delivery covers the request (another user\'s suppliers)', async () => {
    rows = [{ id: 1, ownerAddress: 'pokt1owner', addresses: ['pokt1a'] }]
    await expect(claimRelease('pokt1user', 'pokt1provider', ['pokt1other'])).resolves.toEqual({ kind: 'none' })
  })

  it('refuses a release that spans deliveries with different owners', async () => {
    rows = [
      { id: 1, ownerAddress: 'pokt1ownerA', addresses: ['pokt1a'] },
      { id: 2, ownerAddress: 'pokt1ownerB', addresses: ['pokt1b'] },
    ]
    await expect(claimRelease('pokt1user', 'pokt1provider', ['pokt1a', 'pokt1b'])).resolves.toEqual({ kind: 'mixed-owners' })
  })
})

describe('recordDelivery', () => {
  it('records the delivery with a 24h release window', async () => {
    const now = new Date('2026-01-15T12:00:00Z')
    await recordDelivery({ userIdentity: 'u', providerIdentity: 'p', ownerAddress: 'o', addresses: ['a'] }, now)
    expect(inserted).toEqual([expect.objectContaining({ expiresAt: new Date(now.getTime() + DELIVERY_RELEASE_WINDOW_MS) })])
  })

  it('records nothing for an empty delivery', async () => {
    await recordDelivery({ userIdentity: 'u', providerIdentity: 'p', ownerAddress: 'o', addresses: [] })
    expect(inserted).toEqual([])
  })
})
