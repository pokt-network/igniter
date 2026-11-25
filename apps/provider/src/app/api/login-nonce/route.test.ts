jest.mock('@/auth.config', () => ({ useSecureCookies: true }))

process.env.AUTH_SECRET = 's'.repeat(32)

import { GET } from './route'
import { readLoginNonceCookie } from '@igniter/ui/lib/siwpLogin'

describe('GET /api/login-nonce', () => {
  it('returns a nonce and sets it as a signed, HttpOnly, Strict __Host- cookie', async () => {
    const response = await GET()
    const { nonce, issuedAt, expirationTime } = await response.json()
    const cookie = response.headers.get('set-cookie') ?? ''

    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    // Server-clock message times: issued now, valid for the nonce's 5 minutes.
    expect(Math.abs(Date.parse(issuedAt) - Date.now())).toBeLessThan(5000)
    expect(Date.parse(expirationTime) - Date.parse(issuedAt)).toBe(5 * 60 * 1000)
    expect(cookie).toMatch(/^__Host-provider\.login-nonce=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=strict/i)
    expect(cookie).toMatch(/Path=\//)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const value = decodeURIComponent((cookie.split(';')[0] ?? '').split('=').slice(1).join('='))
    expect(readLoginNonceCookie(process.env.AUTH_SECRET!, value)).toBe(nonce)
  })
})
