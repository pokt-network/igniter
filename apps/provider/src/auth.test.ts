jest.mock('server-only', () => ({}))

let config: any
jest.mock('next-auth', () => ({
  __esModule: true,
  default: (c: unknown) => {
    config = c
    return { handlers: {}, auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() }
  },
}))
jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: (c: unknown) => c }))
jest.mock('./auth.config', () => ({
  __esModule: true,
  default: { callbacks: {} },
  SESSION_MAX_AGE_SECONDS: 30 * 60,
  useSecureCookies: true,
}))

const verifySiwpLogin = jest.fn()
jest.mock('@igniter/ui/lib/siwpLogin', () => {
  const actual = jest.requireActual('@igniter/ui/lib/siwpLogin')
  return { ...actual, verifySiwpLogin: (...args: unknown[]) => verifySiwpLogin(...args) }
})
jest.mock('./lib/dal/applicationSettings', () => ({ getApplicationSettings: async () => ({ chainId: 'pocket' }) }))
jest.mock('@/config/env', () => ({ env: { OWNER_IDENTITY: 'pokt1currentownercurrentownercurrentowner' } }))

const getUser = jest.fn()
jest.mock('./lib/dal/users', () => ({ getUser: (id: string) => getUser(id), createUser: jest.fn() }))

process.env.AUTH_URL = 'https://provider.example'
process.env.AUTH_SECRET = 's'.repeat(32)

import { refreshSessionToken } from './auth'
import { UserRole } from '@igniter/db/provider/enums'

const OWNER = 'pokt1currentownercurrentownercurrentowner'
const token = (identity: string, loginAt = Date.now()) => ({ user: { identity, role: UserRole.Owner }, loginAt })

beforeEach(() => {
  jest.clearAllMocks()
  getUser.mockImplementation(async (identity: string) => ({ identity, role: UserRole.User }))
})

describe('authorize', () => {
  it("reads the provider's __Host- nonce cookie from the request", async () => {
    verifySiwpLogin.mockResolvedValue(OWNER)
    const req = new Request('https://provider.example/api/auth/callback/siwp', { headers: { cookie: '__Host-provider.login-nonce=n.1.mac' } })
    await config.providers[0].authorize({ message: '{}' }, req)
    expect(verifySiwpLogin).toHaveBeenCalledWith({ message: '{}' }, expect.objectContaining({
      domain: 'provider.example', chainId: 'pocket', nonceCookie: 'n.1.mac',
    }))
  })
})

describe('refreshSessionToken (jwt callback on every session read)', () => {
  it('keeps the session of the current OWNER_IDENTITY, as owner', async () => {
    const refreshed = await refreshSessionToken(token(OWNER))
    expect((refreshed!.user as { role: string }).role).toBe(UserRole.Owner)
  })

  it('ends the session of anyone who is not OWNER_IDENTITY now (a rotated-out owner)', async () => {
    await expect(refreshSessionToken(token('pokt1formerowner'))).resolves.toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })

  it('ends the session when the user row is gone', async () => {
    getUser.mockResolvedValue(undefined)
    await expect(refreshSessionToken(token(OWNER))).resolves.toBeNull()
  })

  it('ends the session 30 minutes after login, and for tokens without loginAt', async () => {
    await expect(refreshSessionToken(token(OWNER, Date.now() - 30 * 60 * 1000 - 1))).resolves.toBeNull()
    await expect(refreshSessionToken({ user: { identity: OWNER } })).resolves.toBeNull()
  })
})
