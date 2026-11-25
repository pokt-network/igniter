jest.mock('server-only', () => ({}))

// Capture the config auth.ts hands to NextAuth, so authorize() and the jwt callback run for real.
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

const OWNER = 'pokt1ownerownerownerownerownerownerownerow'
jest.mock('@/config/env', () => ({ env: { OWNER_IDENTITY: 'pokt1ownerownerownerownerownerownerownerow' } }))

const rows = new Map<string, { identity: string; role: string }>()
const updates: Array<{ identity: string; role: string }> = []
jest.mock('@/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [...rows.values()].filter((r) => r.identity === currentLookup) }) }) }),
    update: () => ({
      set: (values: { role: string }) => ({
        where: () => ({
          returning: async () => {
            const row = { ...rows.get(currentLookup)!, ...values }
            rows.set(row.identity, row)
            updates.push(row)
            return [row]
          },
        }),
      }),
    }),
    insert: () => ({ values: (v: { identity: string; role: string }) => ({ returning: async () => { rows.set(v.identity, v); return [v] } }) }),
  }),
}))
// getUser/syncUserRole filter by identity; the fake DB keys the lookup on the identity last asked for.
let currentLookup = ''
jest.mock('drizzle-orm', () => ({ ...jest.requireActual('drizzle-orm'), eq: (_col: unknown, value: string) => { currentLookup = value; return {} } }))

process.env.AUTH_URL = 'https://middleman.example'
process.env.AUTH_SECRET = 's'.repeat(32)

import './auth'
import { refreshSessionToken } from './auth'
import { SiwpLoginError } from '@igniter/ui/lib/siwpLogin'
import { UserRole } from '@igniter/db/middleman/enums'

const authorize = (creds: unknown, req: Request) => config.providers[0].authorize(creds, req)
const request = (cookie: string) => new Request('https://middleman.example/api/auth/callback/siwp', { headers: { cookie } })

beforeEach(() => {
  rows.clear()
  updates.length = 0
  verifySiwpLogin.mockReset()
})

describe('authorize', () => {
  it("passes the request's __Host- nonce cookie, the AUTH_URL host and the app chain id to the verifier", async () => {
    verifySiwpLogin.mockResolvedValue('pokt1user')
    rows.set('pokt1user', { identity: 'pokt1user', role: UserRole.User })
    await authorize({ message: '{}' }, request('__Host-middleman.login-nonce=n.1.mac'))
    expect(verifySiwpLogin).toHaveBeenCalledWith({ message: '{}' }, expect.objectContaining({
      domain: 'middleman.example',
      chainId: 'pocket',
      nonceCookie: 'n.1.mac',
    }))
  })

  it('returns null when the verifier refuses the login', async () => {
    verifySiwpLogin.mockRejectedValue(new SiwpLoginError('the nonce was not issued by this server'))
    await expect(authorize({ message: '{}' }, request(''))).resolves.toBeNull()
  })

  it('makes the current OWNER_IDENTITY owner at login, even when its row says user', async () => {
    verifySiwpLogin.mockResolvedValue(OWNER)
    rows.set(OWNER, { identity: OWNER, role: UserRole.User })
    const user = await authorize({}, request(''))
    expect(user.role).toBe(UserRole.Owner)
    expect(updates).toEqual([{ identity: OWNER, role: UserRole.Owner }])
  })

  it('demotes a former owner (no longer OWNER_IDENTITY) to user at login', async () => {
    verifySiwpLogin.mockResolvedValue('pokt1formerowner')
    rows.set('pokt1formerowner', { identity: 'pokt1formerowner', role: UserRole.Owner })
    const user = await authorize({}, request(''))
    expect(user.role).toBe(UserRole.User)
    expect(updates).toEqual([{ identity: 'pokt1formerowner', role: UserRole.User }])
  })
})

describe('refreshSessionToken (jwt callback on every session read)', () => {
  const token = (identity: string, loginAt = Date.now()) => ({ user: { identity, role: UserRole.Owner }, loginAt })

  it('takes the role from OWNER_IDENTITY now, not from the token', async () => {
    rows.set('pokt1formerowner', { identity: 'pokt1formerowner', role: UserRole.Owner })
    const refreshed = await refreshSessionToken(token('pokt1formerowner'))
    expect((refreshed!.user as { role: string }).role).toBe(UserRole.User)
  })

  it('keeps the current owner as owner', async () => {
    rows.set(OWNER, { identity: OWNER, role: UserRole.Owner })
    const refreshed = await refreshSessionToken(token(OWNER))
    expect((refreshed!.user as { role: string }).role).toBe(UserRole.Owner)
  })

  it('ends the session when the user row is gone', async () => {
    await expect(refreshSessionToken(token('pokt1deleted'))).resolves.toBeNull()
  })

  it('ends the session 30 minutes after login, and for tokens issued before this change (no loginAt)', async () => {
    rows.set('pokt1user', { identity: 'pokt1user', role: UserRole.User })
    await expect(refreshSessionToken(token('pokt1user', Date.now() - 30 * 60 * 1000 - 1))).resolves.toBeNull()
    await expect(refreshSessionToken({ user: { identity: 'pokt1user' } })).resolves.toBeNull()
  })

  it('the jwt callback stamps loginAt at sign-in', async () => {
    const result = await config.callbacks.jwt({ token: {}, user: { identity: 'pokt1user', role: UserRole.User } })
    expect(typeof result.loginAt).toBe('number')
  })
})
