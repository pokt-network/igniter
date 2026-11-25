// next-auth's `auth(handler)` attaches the decoded session as `req.auth`; stand it in with a
// pass-through so the handler runs against a hand-built session.
jest.mock('next-auth', () => ({
  __esModule: true,
  default: () => ({ auth: (handler: unknown) => handler }),
}))
jest.mock('./auth.config', () => ({ __esModule: true, default: {} }))

import { NextRequest } from 'next/server'
import middleware from './middleware'

function run(pathname: string, session: unknown) {
  const req = new NextRequest(`http://provider.test${pathname}`) as NextRequest & { auth?: unknown }
  req.auth = session
  return middleware(req)
}

describe('middleware', () => {
  it.each([
    ['no session', null],
    ['a session object without a user', { expires: '2099-01-01T00:00:00.000Z' }],
  ])('redirects %s', async (_name, session) => {
    const response = await run('/admin/overview', session)
    expect(response.headers.get('location')).toBe('http://provider.test/')
  })

  it('lets a session with a user through', async () => {
    const response = await run('/admin/overview', { user: { identity: 'pokt1owner' } })
    expect(response.headers.get('location')).toBeNull()
  })
})
