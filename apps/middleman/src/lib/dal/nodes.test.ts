jest.mock('server-only', () => ({}))

const where = jest.fn()
const select = jest.fn(() => ({ from: () => ({ where }) }))
jest.mock('@/db', () => ({
  getDb: () => ({ select }),
}))

import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { sumStakeAmountByAddresses } from './nodes'

/** Render the condition drizzle actually emitted, so filters can be asserted. */
function renderedWhere(): string {
  return new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL).sql
}

/**
 * Contract tests for the shared query behind the app's binder (see
 * createNodeQueries in @igniter/db). The rule under test is that a stored
 * transaction amount is authoritative forever — readers stop consulting the
 * payload and the workflow self-heal stops revisiting the row — so this query
 * must return null rather than any total it cannot fully vouch for.
 */
describe('sumStakeAmountByAddresses (middleman)', () => {
  beforeEach(() => {
    where.mockReset()
    select.mockClear()
  })

  it('returns the total when every address resolved to a node', async () => {
    where.mockResolvedValue([{ total: '9300000000000', matched: 2 }])

    await expect(sumStakeAmountByAddresses(['pokt1a', 'pokt1b'], { createdBy: 'pokt1owner' })).resolves.toBe('9300000000000')
  })

  it('short-circuits on an empty address list without touching the database', async () => {
    await expect(sumStakeAmountByAddresses([], { createdBy: 'pokt1owner' })).resolves.toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it('returns null when only some addresses resolved, rather than a partial total', async () => {
    // A partial sum is worse than none: it looks authoritative, and nothing
    // ever revisits it. Null degrades to the payload sum, a visible unknown.
    where.mockResolvedValue([{ total: '4000000000', matched: 2 }])

    await expect(sumStakeAmountByAddresses(['pokt1a', 'pokt1b', 'pokt1c'], { createdBy: 'pokt1owner' })).resolves.toBeNull()
  })

  it('collapses duplicate addresses before counting matches', async () => {
    // extractTransactionUnstakingSuppliers dedupes by operator address, so a
    // payload naming one supplier twice must still match on a count of one.
    where.mockResolvedValue([{ total: '4000000000', matched: 1 }])

    await expect(sumStakeAmountByAddresses(['pokt1a', 'pokt1a'], { createdBy: 'pokt1owner' })).resolves.toBe('4000000000')
  })

  it('returns null for a zero total', async () => {
    // Imported suppliers carry stakeAmount '0' until SupplierStatus syncs them.
    // Storing that zero would render 0.00 forever and block every later heal.
    where.mockResolvedValue([{ total: '0', matched: 1 }])

    await expect(sumStakeAmountByAddresses(['pokt1a'], { createdBy: 'pokt1owner' })).resolves.toBeNull()
  })

  it('returns null when one supplier in the set has zero stake', async () => {
    // Regression: checking only the TOTAL for zero is not enough. A set mixing
    // real stakes with one not-yet-synced '0' supplier passes the count check
    // and yields a partial sum that then reads as authoritative forever. The
    // query excludes zero rows from the match, so the count falls short.
    where.mockResolvedValue([{ total: '120000000000', matched: 2 }])

    await expect(
      sumStakeAmountByAddresses(['pokt1a', 'pokt1b', 'pokt1zero'], { createdBy: 'pokt1owner' }),
    ).resolves.toBeNull()

    // Pin the mechanism, not just the outcome: a mocked db returns whatever
    // `matched` we say, so without this the filter could be deleted and this
    // test would still pass. Zero rows must be excluded from the MATCH, which
    // is what makes the count fall short.
    expect(renderedWhere()).toContain("~ '^0*[1-9][0-9]*$'")
    // Same reasoning for the overflow bound: a mocked db cannot exercise it.
    expect(renderedWhere()).toContain('length(')
  })

  it('scopes the sum to the caller when createdBy is given', async () => {
    // The isolation guarantee: a client-supplied payload naming another
    // account's suppliers must not be able to sum them. Asserted on the emitted
    // condition because a mocked db cannot prove it any other way -- without
    // this, deleting the filter leaves every other test green.
    where.mockResolvedValue([{ total: '4000000000', matched: 1 }])

    await sumStakeAmountByAddresses(['pokt1a'], { createdBy: 'pokt1owner' })

    expect(renderedWhere()).toContain('"createdBy"')
  })

  it('still scopes when createdBy is an empty string', async () => {
    // Fail closed: createdBy is required and the filter is unconditional, so
    // an empty identity must still NARROW the query (matching nothing) rather
    // than widen it to every user's suppliers.
    where.mockResolvedValue([{ total: '4000000000', matched: 1 }])

    await sumStakeAmountByAddresses(['pokt1a'], { createdBy: '' })

    expect(renderedWhere()).toContain('"createdBy"')
  })

  it('returns null when no rows matched at all', async () => {
    where.mockResolvedValue([{ total: null, matched: 0 }])

    await expect(sumStakeAmountByAddresses(['pokt1a'], { createdBy: 'pokt1owner' })).resolves.toBeNull()
  })
})
