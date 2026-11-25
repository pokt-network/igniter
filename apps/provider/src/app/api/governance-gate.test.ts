jest.mock('server-only', () => ({}))

import { REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER } from '@igniter/commons/constants'

// The real validateRequestSignature and the real governance registry run here; only their
// leaves are replaced. A request passes when the delegator is enabled in the database, the
// signature verifies, and the governance file (fetched from DELEGATORS_CDN_URL) lists it now.

const IDENTITY = '02' + 'ab'.repeat(32)
const OWNER = 'pokt1owner0000000000000000000000000000000'

// Database rows of the delegators table, by identity.
let dbRows: Record<string, { identity: string; name: string; enabled: boolean }>
jest.mock('@/lib/dal/delegators', () => ({
  getDelegatorByIdentity: async (identity: string) => {
    const row = dbRows[identity]
    return row && row.enabled ? row : undefined
  },
}))

jest.mock('@/lib/dal/applicationSettings', () => ({
  getApplicationSettings: async () => ({
    isBootstrapped: true,
    chainId: 'pocket',
    minimumStake: 1,
    rewardAddresses: [],
    returnSupplierFundsToOwner: false,
  }),
}))

jest.mock('@igniter/commons/crypto', () => ({
  ...jest.requireActual('@igniter/commons/crypto'),
  verifySignature: async () => true,
  pubkeyToAddress: () => OWNER,
}))
jest.mock('@/lib/adr36', () => ({ verifyAdr36Signature: async () => true }))

// What each route needs after the gate to reach its normal success.
jest.mock('@/lib/dal/addressGroups', () => ({
  list: async () => [],
  findById: async () => ({ id: 7, private: false, linkedAddresses: [] }),
}))
jest.mock('@/lib/dal/regions', () => ({ list: async () => [] }))
jest.mock('@/lib/services/suppliers', () => ({
  getSupplierStakeConfigurations: async () => [{ operatorAddress: 'pokt1op', stakeAmount: '1', services: [] }],
  releaseDeliveredSuppliers: async () => undefined,
}))
jest.mock('@/lib/dal/keys', () => ({
  listAddressesDeliveredTo: async (addresses: string[]) => addresses,
}))
jest.mock('@/lib/temporal', () => ({
  getTemporalClient: () => ({ workflow: { start: async () => undefined } }),
  getTemporalConfig: () => ({ taskQueue: 'provider' }),
}))
jest.mock('@/db', () => ({
  getDbClient: () => ({
    db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) }) },
  }),
}))
jest.mock('@/lib/dal/importSupplierRequests', () => ({
  findSuppliersByOwner: async () => [
    { address: 'pokt1open', publicKey: 'p1', addressGroup: { private: false, linkedAddresses: [] } },
  ],
  assignSuppliersToDelegate: async (addresses: string[]) =>
    addresses.map((address) => ({ address, publicKey: 'pk', stakeAmountUpokt: 0n, services: [] })),
  createImportRequest: async () => ({ id: 1, nonce: 'n', expiresAt: new Date() }),
  cancelPendingRequests: async () => 0,
  findPendingRequest: async () => ({ id: 1, nonce: 'nonce' }),
  findLatestRequest: async () => ({ id: 1, status: 'completed', matchingSupplierAddresses: ['pokt1open'] }),
  isRequestExpired: () => false,
  markRequestCompleted: async () => undefined,
  markRequestExpired: async () => undefined,
  markRequestFailed: async () => undefined,
}))

type Handler = (request: Request) => Promise<Response>

// The 9 provider routes that authenticate the middleman with validateRequestSignature.
const ROUTES: [string, string, unknown][] = [
  ['/api/status', './status/route', {}],
  ['/api/suppliers', './suppliers/route', {
    addressGroupId: 7, ownerAddress: OWNER, revSharePercentage: 5, delegatorAddress: 'pokt1delegator',
    items: [{ amount: 60000000000, qty: 2 }],
  }],
  ['/api/suppliers/stake', './suppliers/stake/route', { addresses: ['pokt1a'] }],
  ['/api/suppliers/unstaking', './suppliers/unstaking/route', { addresses: ['pokt1a'] }],
  ['/api/suppliers/release', './suppliers/release/route', { addresses: ['pokt1a'], ownerAddress: 'pokt1owner' }],
  ['/api/suppliers/address-groups', './suppliers/address-groups/route', { addresses: ['pokt1a'] }],
  ['/api/import-suppliers/request', './import-suppliers/request/route', { ownerAddress: OWNER }],
  ['/api/import-suppliers/submit', './import-suppliers/submit/route', {
    ownerAddress: OWNER, ownerPublicKey: '02' + 'a'.repeat(64), signedNonce: 'sig',
    delegatorAddress: 'pokt1delegator', revSharePercentage: 5,
  }],
  ['/api/import-suppliers/status', './import-suppliers/status/route', { ownerAddress: OWNER }],
]

const fetchMock = jest.fn()
const originalFetch = global.fetch
const originalCdnUrl = process.env.DELEGATORS_CDN_URL

function governanceLists(...identities: string[]) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(
    identities.map((identity) => ({ name: 'mm', identity, identityHistory: [] })),
  ), { status: 200 }))
}

// Loads the route in a fresh module registry, so every test starts with a cold governance cache.
function loadRoute(modulePath: string): Handler {
  let handler: Handler | undefined
  jest.isolateModules(() => {
    handler = require(modulePath).POST
  })
  return handler!
}

function call(handler: Handler, path: string, body: unknown) {
  return handler(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { [REQUEST_IDENTITY_HEADER]: IDENTITY, [REQUEST_SIGNATURE_HEADER]: 'sig' },
    body: JSON.stringify(body),
  }))
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.DELEGATORS_CDN_URL = 'https://cdn.example/{chainId}/delegators.json'
})

afterAll(() => {
  global.fetch = originalFetch
  process.env.DELEGATORS_CDN_URL = originalCdnUrl
})

beforeEach(() => {
  fetchMock.mockReset()
  dbRows = { [IDENTITY]: { identity: IDENTITY, name: 'mm', enabled: true } }
})

describe.each(ROUTES)('POST %s governance gate', (path, modulePath, body) => {
  it('serves a delegator enabled in the database and listed in governance', async () => {
    governanceLists(IDENTITY)
    const response = await call(loadRoute(modulePath), path, body)
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/pocket/delegators.json', expect.anything())
  })

  it('refuses a delegator enabled in the database but not listed in governance', async () => {
    governanceLists('02' + 'cd'.repeat(32))
    const response = await call(loadRoute(modulePath), path, body)
    expect(response.status).toBe(403)
  })

  it('refuses a delegator listed in governance but disabled in the database', async () => {
    dbRows[IDENTITY]!.enabled = false
    governanceLists(IDENTITY)
    const response = await call(loadRoute(modulePath), path, body)
    expect(response.status).toBe(403)
  })

  it('answers 503 when the governance cache is cold and the source is down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const response = await call(loadRoute(modulePath), path, body)
    expect(response.status).toBe(503)
  })
})
