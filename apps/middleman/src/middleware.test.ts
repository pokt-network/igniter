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

function run(pathname: string, session: unknown) {
  const req = new NextRequest(`http://middleman.test${pathname}`) as NextRequest & { auth?: unknown }
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
})
