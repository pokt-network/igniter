jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAuth from lib/utils/actions runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

jest.mock('@/lib/logging/withLogging', () => ({
  runWithRequestContext: (fn: () => unknown) => fn(),
}))
const values = jest.fn()
jest.mock('@/db', () => ({
  getDb: () => ({
    insert: () => ({
      values: (rows: Array<{ address: string }>) => {
        values(rows)
        return { onConflictDoNothing: () => ({ returning: async () => rows.map((r) => ({ address: r.address })) }) }
      },
    }),
  }),
}))
jest.mock('@/lib/dal/nodes', () => ({
  getExistingNodes: async () => [],
  getNodeAddressesByOwnerAndProvider: jest.fn(),
}))
jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({ pocketApiUrl: 'https://api.example', appIdentity: 'app-identity' }),
}))
const signPayload = jest.fn()
jest.mock('@igniter/commons/crypto', () => ({ signPayload: (payload: string) => signPayload(payload) }))

const resolveGovernance = jest.fn()
jest.mock('@/lib/governance', () => ({ governance: { resolve: (identity: string) => resolveGovernance(identity) } }))

const cancelPending = jest.fn()
const create = jest.fn()
const getById = jest.fn()
const update = jest.fn()
const markCompleted = jest.fn()
jest.mock('@/lib/dal/importSupplierAttempts', () => ({
  cancelPending: (...args: unknown[]) => cancelPending(...args),
  create: (...args: unknown[]) => create(...args),
  getById: (id: number) => getById(id),
  update: (...args: unknown[]) => update(...args),
  markCompleted: (...args: unknown[]) => markCompleted(...args),
}))

import { toBech32 } from '@cosmjs/encoding'
import { CancelPendingImportAttempts, CompleteImportAttempt, CreateImportAttempt, UpdateImportAttemptStatus } from './ImportSuppliers'
import { ImportAttemptStatus, UserRole } from '@igniter/db/middleman/enums'

const OWNER = toBech32('pokt', new Uint8Array(20).fill(1))
const SUPPLIER = toBech32('pokt', new Uint8Array(20).fill(2))
const OTHER_SUPPLIER = toBech32('pokt', new Uint8Array(20).fill(3))

const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  userIdentity: 'pokt1caller',
  ownerAddress: OWNER,
  providerIdentity: 'pokt1provider',
  nonce: 'nonce-1',
  status: ImportAttemptStatus.Submitted,
  ...overrides,
})

const fetchMock = jest.fn()
// Answers for the provider status call and the chain supplier reads, keyed by url.
let providerAnswer: { ok: boolean; status: number; body: unknown }
let chainSuppliers: Record<string, { owner_address: string; stake: { amount: string } } | 'error'>

beforeEach(() => {
  jest.clearAllMocks()
  cancelPending.mockResolvedValue(1)
  create.mockResolvedValue({ id: 5 })
  getById.mockImplementation(async () => attempt())
  signPayload.mockResolvedValue(Buffer.from('sig'))
  resolveGovernance.mockResolvedValue({ identity: 'pokt1provider', url: 'https://p.example' })
  providerAnswer = { ok: true, status: 200, body: { data: { status: 'completed', importedSupplierAddresses: [SUPPLIER] } } }
  chainSuppliers = { [SUPPLIER]: { owner_address: OWNER, stake: { amount: '60000000000' } } }
  global.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockImplementation(async (url: string) => {
    if (url === 'https://p.example/api/import-suppliers/status') {
      return { ok: providerAnswer.ok, status: providerAnswer.status, json: async () => providerAnswer.body }
    }
    const prefix = 'https://api.example/pokt-network/poktroll/supplier/supplier/'
    if (url.startsWith(prefix)) {
      const found = chainSuppliers[decodeURIComponent(url.slice(prefix.length))]
      if (found === 'error') return { ok: false, status: 503, json: async () => ({}) }
      if (!found) return { ok: false, status: 404, json: async () => ({ code: 5 }) }
      return { ok: true, status: 200, json: async () => ({ supplier: found }) }
    }
    // getCurrentHeight
    return { ok: true, status: 200, json: async () => ({ height: '100' }) }
  })
})

describe('CreateImportAttempt', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
  })

  it('rejects a provider identity the governance source does not list', async () => {
    resolveGovernance.mockResolvedValue(null)
    await expect(CreateImportAttempt('pokt1owner', 'pokt1other', 9, 'nonce')).rejects.toThrow('not in the governance source')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates the attempt for a governance provider', async () => {
    resolveGovernance.mockResolvedValue({ identity: 'pokt1provider', url: 'https://p.example' })
    await expect(CreateImportAttempt('pokt1owner', 'pokt1provider', 9, 'nonce')).resolves.toBe(5)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ providerIdentity: 'pokt1provider', userIdentity: 'pokt1caller' }))
  })
})

describe('CancelPendingImportAttempts', () => {
  it('refuses a request without a session', async () => {
    auth.mockResolvedValue(null)
    await expect(CancelPendingImportAttempts('pokt1owner', 'pokt1provider')).rejects.toThrow('Not logged in')
    expect(cancelPending).not.toHaveBeenCalled()
  })

  it("scopes the cancel to the caller's identity", async () => {
    auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
    await CancelPendingImportAttempts('pokt1owner', 'pokt1provider')
    expect(cancelPending).toHaveBeenCalledWith('pokt1owner', 'pokt1provider', 'pokt1caller')
  })
})

describe('CompleteImportAttempt', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
  })

  it('records the provider of the owned attempt, not the one the client sends', async () => {
    await CompleteImportAttempt(5, [{ address: SUPPLIER, stakeAmount: '1' }] as never, 'pokt1other')
    expect(values).toHaveBeenCalledWith([expect.objectContaining({ address: SUPPLIER, providerId: 'pokt1provider' })])
  })

  it("asks the governance provider for this attempt's nonce, signed over the body it sends", async () => {
    await CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')
    expect(resolveGovernance).toHaveBeenCalledWith('pokt1provider')
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === 'https://p.example/api/import-suppliers/status')!
    expect(url).toBe('https://p.example/api/import-suppliers/status')
    expect(JSON.parse(init.body)).toEqual({ ownerAddress: OWNER, nonce: 'nonce-1' })
    expect(signPayload).toHaveBeenCalledWith(init.body)
    expect(init.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }))
  })

  it('saves only suppliers the provider confirmed, with the stake amount from the chain', async () => {
    chainSuppliers[OTHER_SUPPLIER] = { owner_address: OWNER, stake: { amount: '5' } }
    await CompleteImportAttempt(5, [
      { address: SUPPLIER, stakeAmount: '999' },
      { address: OTHER_SUPPLIER, stakeAmount: '999' },
    ] as never, 'pokt1provider')
    expect(values).toHaveBeenCalledWith([expect.objectContaining({ address: SUPPLIER, stakeAmount: '60000000000', ownerAddress: OWNER })])
    expect(markCompleted).toHaveBeenCalledWith(5, [SUPPLIER])
  })

  it('skips a supplier the chain says another owner owns', async () => {
    chainSuppliers[SUPPLIER] = { owner_address: OTHER_SUPPLIER, stake: { amount: '1' } }
    await CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')
    expect(values).not.toHaveBeenCalled()
    expect(markCompleted).toHaveBeenCalledWith(5, [])
  })

  it('skips a supplier the chain does not know', async () => {
    delete chainSuppliers[SUPPLIER]
    await CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')
    expect(values).not.toHaveBeenCalled()
  })

  it('fails without completing when the chain cannot be read', async () => {
    chainSuppliers[SUPPLIER] = 'error'
    await expect(CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')).rejects.toThrow('could not be read')
    expect(markCompleted).not.toHaveBeenCalled()
  })

  it('refuses an address that is not a pokt address before any chain read', async () => {
    providerAnswer.body = { data: { status: 'completed', importedSupplierAddresses: ['../../x'] } }
    await CompleteImportAttempt(5, [{ address: '../../x' }] as never, 'pokt1provider')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('supplier/supplier'))).toBe(false)
    expect(values).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', { ok: true, status: 200, body: { data: { status: 'pending' } } }, 'not completed'],
    ['failed', { ok: true, status: 200, body: { data: { status: 'failed' } } }, 'not completed'],
    ['an HTTP error', { ok: false, status: 404, body: { error: 'x' } }, 'HTTP 404'],
  ])('refuses to complete when the provider answers %s', async (_label, answer, message) => {
    providerAnswer = answer
    await expect(CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')).rejects.toThrow(message)
    expect(values).not.toHaveBeenCalled()
    expect(markCompleted).not.toHaveBeenCalled()
  })

  it('refuses an attempt that was not submitted', async () => {
    getById.mockResolvedValue(attempt({ status: ImportAttemptStatus.Signed }))
    await expect(CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')).rejects.toThrow('was not submitted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an attempt without a nonce', async () => {
    getById.mockResolvedValue(attempt({ nonce: null }))
    await expect(CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')).rejects.toThrow('no nonce')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing for an attempt the recovery workflow already completed', async () => {
    getById.mockResolvedValue(attempt({ status: ImportAttemptStatus.Completed }))
    await CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markCompleted).not.toHaveBeenCalled()
  })

  it('refuses a provider the governance source no longer lists', async () => {
    resolveGovernance.mockResolvedValue(null)
    await expect(CompleteImportAttempt(5, [{ address: SUPPLIER }] as never, 'pokt1provider')).rejects.toThrow('not in the governance source')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('UpdateImportAttemptStatus', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
    getById.mockResolvedValue(attempt({ status: ImportAttemptStatus.Initiated }))
  })

  it('writes the status and the known date fields', async () => {
    const signedAt = new Date('2026-01-15T00:00:00Z')
    await UpdateImportAttemptStatus(5, ImportAttemptStatus.Signed, { signedAt })
    expect(update).toHaveBeenCalledWith(5, { status: ImportAttemptStatus.Signed, signedAt })
  })

  it('refuses a status outside the enum', async () => {
    await expect(UpdateImportAttemptStatus(5, 'hacked' as ImportAttemptStatus)).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses to set Completed', async () => {
    await expect(UpdateImportAttemptStatus(5, ImportAttemptStatus.Completed)).rejects.toThrow('completed only from the provider result')
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses unknown fields in data', async () => {
    await expect(UpdateImportAttemptStatus(5, ImportAttemptStatus.Signed, {
      importedSupplierAddresses: ['pokt1x'], userIdentity: 'pokt1other',
    } as never)).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a date field that is not a date and an over-long error message', async () => {
    await expect(UpdateImportAttemptStatus(5, ImportAttemptStatus.Signed, { signedAt: 'yesterday' } as never)).rejects.toThrow()
    await expect(UpdateImportAttemptStatus(5, ImportAttemptStatus.Failed, { errorMessage: 'x'.repeat(1001) })).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})
