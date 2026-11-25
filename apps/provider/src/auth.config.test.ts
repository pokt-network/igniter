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
