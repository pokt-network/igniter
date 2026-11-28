jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: {} }))
jest.mock('@poktscan/vault-siwp', () => ({ SiwpMessage: jest.fn() }))
jest.mock('@/config/env', () => ({ env: { OWNER_IDENTITY: 'pokt1owner' } }))

import authConfig, { SESSION_MAX_AGE_SECONDS } from './auth.config'

// The edge middleware runs this callback (no DB): it must end the session at the cap too.
const jwt = (token: Record<string, unknown>, user?: unknown) =>
  (authConfig.callbacks!.jwt as (args: { token: Record<string, unknown>; user?: unknown }) => Promise<unknown>)({ token, user })

describe('authConfig.callbacks.jwt (edge)', () => {
  it('keeps a session younger than the cap', async () => {
    const token = { loginAt: Date.now() - 60 * 1000, user: { identity: 'pokt1a' } }
    await expect(jwt(token)).resolves.toBe(token)
  })

  it('ends a session older than the cap', async () => {
    await expect(jwt({ loginAt: Date.now() - SESSION_MAX_AGE_SECONDS * 1000 - 1 })).resolves.toBeNull()
  })

  it('ends a session without loginAt (issued before the cap existed)', async () => {
    await expect(jwt({ user: { identity: 'pokt1a' } })).resolves.toBeNull()
  })

  it('leaves the sign-in call to the node callback', async () => {
    const token = {}
    await expect(jwt(token, { identity: 'pokt1a' })).resolves.toBe(token)
  })
})

// The client's expiry timer reads this: `session.expires` slides with every read.
describe('authConfig.callbacks.session', () => {
  const session = (token: Record<string, unknown>) =>
    (authConfig.callbacks!.session as unknown as (args: { session: Record<string, unknown>; token: Record<string, unknown> }) => Promise<Record<string, unknown>>)(
      { session: {}, token },
    )

  it('exposes the time left until the absolute end of the session, by the server clock', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await expect(session({ loginAt: now - 60 * 1000, user: { identity: 'pokt1a' } })).resolves.toMatchObject({
        sessionRemainingMs: SESSION_MAX_AGE_SECONDS * 1000 - 60 * 1000,
      })
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('is never negative past the end', async () => {
    const loginAt = Date.now() - SESSION_MAX_AGE_SECONDS * 1000 - 60 * 1000
    await expect(session({ loginAt, user: { identity: 'pokt1a' } })).resolves.toMatchObject({ sessionRemainingMs: 0 })
  })

  it('leaves it out without loginAt', async () => {
    await expect(session({ user: { identity: 'pokt1a' } })).resolves.not.toHaveProperty('sessionRemainingMs')
  })
})
