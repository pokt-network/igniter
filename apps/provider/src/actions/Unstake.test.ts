jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const listKeysForUnstake = jest.fn()
jest.mock('@/lib/dal/keys', () => ({
  listKeysForUnstake: (...a: unknown[]) => listKeysForUnstake(...a),
  countKeysForUnstake: jest.fn(),
  getUnstakeSummary: jest.fn(),
}))
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: jest.fn() }))
jest.mock('@igniter/graphql', () => ({ unstakeTimeAvgDocument: {} }))
jest.mock('@igniter/ui/graphql/server', () => ({ getServerApolloClient: jest.fn() }))
jest.mock('@igniter/ui/lib/dates', () => ({ getStartAndEndDateBasedOnTime: jest.fn(), Time: {} }))
jest.mock('@igniter/ui/api/blocks', () => ({ getLatestBlock: jest.fn() }))

const inserted: Array<Record<string, unknown>> = []
let conflict = false
jest.mock('@/db', () => ({
  getDbClient: () => ({
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v)
          return {
            onConflictDoNothing: () => ({
              returning: async () => (conflict ? [] : [{ id: inserted.length }]),
            }),
          }
        },
      }),
    },
  }),
}))

import { UnstakeKeys } from './Unstake'

const OP = 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723y'
const CUSTOM = 'pokt1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrlpewsn'

describe('UnstakeKeys', () => {
  beforeEach(() => {
    inserted.length = 0
    conflict = false
    auth.mockReset()
    auth.mockResolvedValue({ user: { role: UserRole.Owner } })
    listKeysForUnstake.mockReset()
    listKeysForUnstake.mockResolvedValue([{ id: 10, address: OP }])
  })

  it('requires the owner', async () => {
    auth.mockResolvedValue({ user: { role: UserRole.Admin } })
    const r = await UnstakeKeys({ filters: {}, returnFunds: { mode: 'owner' } })
    expect(r.success).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('writes the intent row itself, with the custom destination and no private key', async () => {
    const r = await UnstakeKeys({ filters: { keyIds: [10] }, returnFunds: { mode: 'custom', address: CUSTOM } })
    expect(r).toEqual({ success: true, data: { accepted: 1, skipped: 0 } })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ keyId: 10, keyAddress: OP, type: 'unstake', status: 'pending', trigger: 'manual' })
    expect(JSON.parse(inserted[0]!.params as string)).toEqual({
      kind: 'unstake',
      params: { signer: OP, operatorAddress: OP },
      returnFunds: { mode: 'custom', address: CUSTOM },
    })
    expect(inserted[0]!.params).not.toContain('signerPrivateKey')
  })

  it('rejects returnFunds with extra fields (.strict())', async () => {
    const r = await UnstakeKeys({ filters: {}, returnFunds: { mode: 'owner', address: CUSTOM } as never })
    expect(r.success).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it.each([
    ['a non-pokt prefix', { mode: 'custom', address: 'cosmos1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du' }],
    ['a bad checksum', { mode: 'custom', address: 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723z' }],
    ['an unknown mode', { mode: 'all' }],
  ])('rejects %s', async (_l, returnFunds) => {
    const r = await UnstakeKeys({ filters: {}, returnFunds: returnFunds as never })
    expect(r.success).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('counts a key that already has a pending tx as skipped', async () => {
    conflict = true
    const r = await UnstakeKeys({ filters: {}, returnFunds: { mode: 'none' } })
    expect(r).toEqual({ success: true, data: { accepted: 0, skipped: 1 } })
  })
})
