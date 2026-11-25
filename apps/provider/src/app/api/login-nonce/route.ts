import { NextResponse } from 'next/server'
import { loginNonceCookieName, mintLoginNonce } from '@igniter/ui/lib/siwpLogin'
import { useSecureCookies } from '@/auth.config'

export const dynamic = 'force-dynamic'

// Issues the nonce the wallet sign-in message must carry. The nonce is also set as a signed,
// HttpOnly, 5-minute cookie, so authorize() accepts it only from this browser, and only once.
export async function GET() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Sign-in is not configured' }, { status: 503 })
  }

  const { nonce, issuedAt, expirationTime, cookieValue, maxAgeSeconds } = mintLoginNonce(secret)
  const response = NextResponse.json({ nonce, issuedAt, expirationTime }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(loginNonceCookieName('provider', useSecureCookies), cookieValue, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSeconds,
  })
  return response
}
