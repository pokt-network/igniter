// next-auth's `auth(handler)` attaches the decoded session as `req.auth`; stand it in with a
// pass-through so the handler runs against a hand-built session.
jest.mock('next-auth', () => ({
  __esModule: true,
  default: () => ({ auth: (handler: unknown) => handler }),
}))
jest.mock('./auth.config', () => ({ __esModule: true, default: {} }))

import { NextRequest } from 'next/server'
import middleware from './middleware'
import { UserRole } from '@igniter/db/middleman/enums'

function run(pathname: string, session: unknown, headers?: Record<string, string>) {
  const init = headers ? { method: 'POST', headers } : undefined
  const req = new NextRequest(`http://middleman.test${pathname}`, init) as NextRequest & { auth?: unknown }
  req.auth = session
  return middleware(req)
}

const userSession = { user: { identity: 'pokt1user', role: UserRole.User } }
const ownerSession = { user: { identity: 'pokt1owner', role: UserRole.Owner } }

describe('middleware', () => {
  it('redirects a session object that carries no user', async () => {
    const response = await run('/app/overview', { expires: '2099-01-01T00:00:00.000Z' })
    expect(response.headers.get('location')).toBe('http://middleman.test/')
  })

  it('redirects a request without a session', async () => {
    const response = await run('/app/overview', null)
    expect(response.headers.get('location')).toBe('http://middleman.test/')
  })

  it.each(['/admin', '/admin/overview', '/admin/setup'])('redirects a role user session away from %s', async (path) => {
    const response = await run(path, userSession)
    expect(response.headers.get('location')).toBe('http://middleman.test/')
  })

  it('lets the owner through to /admin', async () => {
    const response = await run('/admin/overview', ownerSession)
    expect(response.headers.get('location')).toBeNull()
  })

  it('lets a role user session through to /app', async () => {
    const response = await run('/app/overview', userSession)
    expect(response.headers.get('location')).toBeNull()
  })

  describe('server actions', () => {
    const action = { 'next-action': 'abc', 'x-request-id': 'req-1' }

    it.each([
      ['a request without a session', '/app/overview', null],
      ['a session object that carries no user', '/app/overview', { expires: '2099-01-01T00:00:00.000Z' }],
      ['an /admin action without a session', '/admin/overview', null],
    ])('answers %s with a text/plain 401 instead of a redirect', async (_label, path, session) => {
      const response = await run(path, session, action)
      expect(response.status).toBe(401)
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-request-id')).toBe('req-1')
      expect(await response.text()).toBe('Session expired')
    })

    it('answers a role user action on /admin with a text/plain 403', async () => {
      const response = await run('/admin/overview', userSession, action)
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-request-id')).toBe('req-1')
      expect(await response.text()).toBe('Forbidden')
    })

    it.each([
      ['the owner on /admin', '/admin/overview', ownerSession],
      ['a role user on /app', '/app/overview', userSession],
    ])('lets an action from %s through', async (_label, path, session) => {
      const response = await run(path, session, action)
      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    })
  })
})
