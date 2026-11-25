type Row = { id: number; name: string; identity: string; enabled: boolean }

// The row the transaction re-reads for an update (jest allows `mock`-prefixed vars in factories).
let mockRow: Row | undefined
const inserts: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []
const warn = jest.fn()

jest.mock('@igniter/logger', () => ({
  getLogger: () => ({ warn: (...args: unknown[]) => warn(...args), info: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}))

// A fake drizzle client. The re-read inside the transaction (select ... where id) returns
// `mockRow`; inserts and updates are recorded.
jest.mock('@/db', () => {
  const tx = {
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserts.push(v) } }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v) } }) }),
    select: () => ({ from: () => ({ where: async () => (mockRow ? [mockRow] : []) }) }),
  }
  return {
    getDbClient: () => ({
      db: { transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx) },
    }),
  }
})

import { ZodError } from 'zod'
import { applyGovernanceSync, parseCdnDelegators } from '@/lib/dal/delegators'

beforeEach(() => {
  mockRow = undefined
  inserts.length = 0
  updates.length = 0
  warn.mockClear()
})

function withRow(row: Row) {
  mockRow = row
}

describe('applyGovernanceSync', () => {
  it('inserts new delegators disabled, until the owner approves them', async () => {
    await applyGovernanceSync([{ name: 'New', identity: 'idNew' }], [], [], 'owner')
    expect(inserts).toEqual([expect.objectContaining({ name: 'New', identity: 'idNew', enabled: false })])
  })

  it('inserts new delegators enabled when the owner runs the setup sync', async () => {
    await applyGovernanceSync([{ name: 'New', identity: 'idNew' }], [], [], 'owner', { enableNew: true })
    expect(inserts).toEqual([expect.objectContaining({ name: 'New', identity: 'idNew', enabled: true })])
  })

  it('never rotates the identity of an enabled delegator, and warns instead', async () => {
    withRow({ id: 7, name: 'D', identity: 'idOld', enabled: true })
    await applyGovernanceSync([], [{ id: 7, name: 'D', identity: 'idOther' }], [], 'owner')

    expect(updates).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      delegatorId: 7, currentIdentity: 'idOld', governanceIdentity: 'idOther',
    }))
  })

  it('still updates the name of an enabled delegator, without touching its identity', async () => {
    withRow({ id: 7, name: 'Old name', identity: 'idOld', enabled: true })
    await applyGovernanceSync([], [{ id: 7, name: 'New name', identity: 'idNew' }], [], 'owner')
    expect(updates).toEqual([{ name: 'New name', updatedBy: 'owner' }])
  })

  it('rotates the identity of a disabled delegator', async () => {
    withRow({ id: 7, name: 'D', identity: 'idOld', enabled: false })
    await applyGovernanceSync([], [{ id: 7, name: 'D', identity: 'idNew' }], [], 'owner')
    expect(updates).toEqual([{ identity: 'idNew', name: 'D', updatedBy: 'owner' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects malformed lists before writing anything', async () => {
    const bad: Array<Parameters<typeof applyGovernanceSync>> = [
      [[{ name: '', identity: 'idA' }], [], [], 'owner'],
      [[{ name: 'D', identity: 'x'.repeat(67) }], [], [], 'owner'],
      [[], [{ id: -1, name: 'D', identity: 'idA' }], [], 'owner'],
      [[], [], [{ identity: 42 as unknown as string }], 'owner'],
    ]
    for (const args of bad) {
      await expect(applyGovernanceSync(...args)).rejects.toBeInstanceOf(ZodError)
    }
    expect(inserts).toEqual([])
    expect(updates).toEqual([])
  })
})

describe('parseCdnDelegators', () => {
  it('accepts the governance shape and strips unknown fields', () => {
    expect(parseCdnDelegators([{ name: 'D', identity: 'idA', identityHistory: ['idB'], url: 'http://x' }]))
      .toEqual([{ name: 'D', identity: 'idA', identityHistory: ['idB'] }])
  })

  it('rejects malformed payloads', () => {
    for (const bad of [
      { not: 'an array' },
      [{ name: 'D', identity: 'idA' }],
      [{ name: 'D', identity: 'idA', identityHistory: [1] }],
      [null],
    ]) {
      expect(() => parseCdnDelegators(bad)).toThrow(ZodError)
    }
  })
})
