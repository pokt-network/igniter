jest.mock('next-auth/providers/credentials', () => ({ __esModule: true, default: {} }))

import { expiryDelay, localDeadline, MAX_TIMEOUT_MS } from './sessionExpiryTimer'
import { SESSION_MAX_AGE_SECONDS } from '@/auth.config'

describe('localDeadline', () => {
  it('is the browser time at receipt plus the time left', () => {
    expect(localDeadline(60_000, 1_700_000_000_000)).toBe(1_700_000_060_000)
  })

  it('does not fire at once when the browser clock runs 40 minutes ahead of the server', () => {
    const serverNow = 1_700_000_000_000
    const browserNow = serverNow + 40 * 60 * 1000
    // Logged in 10 minutes ago by the server clock: 20 minutes left.
    const remaining = SESSION_MAX_AGE_SECONDS * 1000 - 10 * 60 * 1000
    const deadline = localDeadline(remaining, browserNow)
    expect(expiryDelay(deadline, browserNow)).toBe(remaining)
    expect(expiryDelay(deadline, browserNow + remaining)).toBe(0)
  })
})

describe('expiryDelay', () => {
  const now = 1_700_000_000_000

  it('is the time left until the absolute end of a fresh session', () => {
    expect(expiryDelay(now + SESSION_MAX_AGE_SECONDS * 1000, now)).toBe(SESSION_MAX_AGE_SECONDS * 1000)
  })

  it('is 0, due now, at and after the deadline', () => {
    expect(expiryDelay(now, now)).toBe(0)
    expect(expiryDelay(now - 60_000, now)).toBe(0)
  })

  it('clamps a delay setTimeout would overflow', () => {
    expect(expiryDelay(now + MAX_TIMEOUT_MS + 1, now)).toBe(MAX_TIMEOUT_MS)
    expect(expiryDelay(now + 365 * 24 * 3600 * 1000, now)).toBe(MAX_TIMEOUT_MS)
  })
})
