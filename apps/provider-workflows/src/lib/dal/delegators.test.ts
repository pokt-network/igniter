import Delegators, { parseCdnDelegators } from '@/lib/dal/delegators'

type Row = { id: number; name: string; identity: string; enabled: boolean }

// A fake drizzle client: listAll() returns `rows`; the transaction records every insert/update.
function makeDal(rows: Row[]) {
  const inserts: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const tx = {
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserts.push(v) } }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v) } }) }),
  }
  const dbClient = {
    db: {
      select: () => ({ from: async () => rows }),
      transaction: async (cb: (t: typeof tx) => Promise<void>) => cb(tx),
    },
  }
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const dal = new Delegators(dbClient as never, logger as never)
  return { dal, inserts, updates, logger }
}

describe('Delegators.upsertFromGovernance', () => {
  it('inserts a new delegator disabled, until the owner approves it', async () => {
    const h = makeDal([])
    await expect(h.dal.upsertFromGovernance([{ name: 'New', identity: 'idNew', identityHistory: [] }], 'owner'))
      .resolves.toEqual({ inserted: 1, updated: 0, disabled: 0 })
    expect(h.inserts).toEqual([expect.objectContaining({ name: 'New', identity: 'idNew', enabled: false })])
  })

  it('never rotates the identity of an enabled delegator, and warns instead', async () => {
    const h = makeDal([{ id: 7, name: 'D', identity: 'idOld', enabled: true }])
    const result = await h.dal.upsertFromGovernance(
      [{ name: 'D', identity: 'idOther', identityHistory: ['idOld'] }], 'owner')

    expect(result).toEqual({ inserted: 0, updated: 0, disabled: 0 })
    expect(h.updates).toEqual([])
    expect(h.inserts).toEqual([])
    expect(h.logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      delegatorId: 7, currentIdentity: 'idOld', governanceIdentity: 'idOther',
    }))
  })

  it('still updates the name of an enabled delegator, without touching its identity', async () => {
    const h = makeDal([{ id: 7, name: 'Old name', identity: 'idOld', enabled: true }])
    await h.dal.upsertFromGovernance([{ name: 'New name', identity: 'idNew', identityHistory: ['idOld'] }], 'owner')
    expect(h.updates).toEqual([{ name: 'New name', updatedBy: 'owner' }])
  })

  it('rotates the identity of a disabled delegator', async () => {
    const h = makeDal([{ id: 7, name: 'D', identity: 'idOld', enabled: false }])
    await h.dal.upsertFromGovernance([{ name: 'D', identity: 'idNew', identityHistory: ['idOld'] }], 'owner')
    expect(h.updates).toEqual([{ identity: 'idNew', name: 'D', updatedBy: 'owner' }])
    expect(h.logger.warn).not.toHaveBeenCalled()
  })

  it('rejects an invalid payload before writing anything', async () => {
    for (const bad of [
      { not: 'an array' },
      [{ name: 'D', identity: 'idA' }], // no identityHistory
      [{ name: 'D', identity: 42, identityHistory: [] }],
      [{ name: '', identity: 'idA', identityHistory: [] }],
      [{ name: 'D', identity: 'x'.repeat(67), identityHistory: [] }],
      [{ name: 'D', identity: 'idA', identityHistory: [null] }],
      [{ name: 'ok', identity: 'idOk', identityHistory: [] }, null],
    ]) {
      const h = makeDal([{ id: 1, name: 'Listed', identity: 'idListed', enabled: true }])
      await expect(h.dal.upsertFromGovernance(bad, 'owner')).rejects.toThrow('Invalid delegators payload')
      expect(h.inserts).toEqual([])
      expect(h.updates).toEqual([]) // in particular, the disable pass did not run
    }
  })
})

describe('parseCdnDelegators', () => {
  it('keeps only the known fields', () => {
    expect(parseCdnDelegators([{ name: 'D', identity: 'idA', identityHistory: ['idB'], url: 'http://x', enabled: true }]))
      .toEqual([{ name: 'D', identity: 'idA', identityHistory: ['idB'] }])
  })
})
