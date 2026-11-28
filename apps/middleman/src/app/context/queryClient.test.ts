const mockSignOut = jest.fn()
jest.mock('next-auth/react', () => ({ __esModule: true, signOut: (...args: unknown[]) => mockSignOut(...args) }))

import { SESSION_EXPIRED_MESSAGE, SESSION_EXPIRED_REDIRECT } from '@/lib/sessionExpired'

type QueryClientModule = typeof import('./queryClient')
type SignOutModule = typeof import('./sessionExpiredSignOut')

// The once-per-page-load guard is module state, so every test loads fresh copies.
function load(): QueryClientModule & SignOutModule {
  let modules!: QueryClientModule & SignOutModule
  jest.isolateModules(() => {
    modules = { ...require('./queryClient'), ...require('./sessionExpiredSignOut') }
  })
  return modules
}

// The caches' handlers are called directly: through a real query the client's
// default retries would delay them.
function setup() {
  const modules = load()
  const client = modules.createQueryClient()
  const cancel = jest.spyOn(client, 'cancelQueries')
  const clear = jest.spyOn(client, 'clear')
  const onQueryError = client.getQueryCache().config.onError!
  const onMutationError = client.getMutationCache().config.onError!
  return { ...modules, cancel, clear, onQueryError, onMutationError }
}

describe('createQueryClient session-expired handling', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue(undefined)
  })

  it('signs out once for several concurrent session-expired errors', () => {
    const { cancel, clear, onQueryError, onMutationError } = setup()

    onQueryError(new Error(SESSION_EXPIRED_MESSAGE), {} as never)
    onQueryError(new Error(SESSION_EXPIRED_MESSAGE), {} as never)
    onMutationError(new Error(SESSION_EXPIRED_MESSAGE), undefined, undefined, {} as never)

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: SESSION_EXPIRED_REDIRECT })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('shares the once-only guard with handleSessionExpired', () => {
    const { handleSessionExpired, cancel, onQueryError } = setup()

    expect(handleSessionExpired(new Error(SESSION_EXPIRED_MESSAGE))).toBe(true)
    onQueryError(new Error(SESSION_EXPIRED_MESSAGE), {} as never)
    expect(handleSessionExpired(new Error(SESSION_EXPIRED_MESSAGE))).toBe(true)

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    // Started elsewhere, the sign-out still leaves the cache to be dropped.
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not retry a session-expired query but keeps 3 retries for other errors', () => {
    const retry = load().createQueryClient().getDefaultOptions().queries!.retry as (n: number, e: Error) => boolean
    expect(retry(0, new Error(SESSION_EXPIRED_MESSAGE))).toBe(false)
    expect(retry(0, new Error('boom'))).toBe(true)
    expect(retry(2, new Error('boom'))).toBe(true)
    expect(retry(3, new Error('boom'))).toBe(false)
  })

  it('signs out from a mutation error too', () => {
    const { onMutationError } = setup()
    onMutationError(new Error(SESSION_EXPIRED_MESSAGE), undefined, undefined, {} as never)
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('ignores errors that are not a session expiry', () => {
    const { cancel, clear, onQueryError, onMutationError } = setup()

    onQueryError(new Error('Not logged in'), {} as never)
    onQueryError(new Error('Forbidden'), {} as never)
    onMutationError(new Error('boom'), undefined, undefined, {} as never)

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})

describe('handleSessionExpired', () => {
  beforeEach(() => {
    mockSignOut.mockReset().mockResolvedValue(undefined)
  })

  it('returns true and signs out for the session-expired error', () => {
    const { handleSessionExpired } = load()
    expect(handleSessionExpired(new Error(SESSION_EXPIRED_MESSAGE))).toBe(true)
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: SESSION_EXPIRED_REDIRECT })
  })

  it('returns false and does not sign out for any other error', () => {
    const { handleSessionExpired } = load()
    expect(handleSessionExpired(new Error('Forbidden'))).toBe(false)
    expect(handleSessionExpired(new Error('Not logged in'))).toBe(false)
    expect(handleSessionExpired(SESSION_EXPIRED_MESSAGE)).toBe(false)
    expect(handleSessionExpired(undefined)).toBe(false)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('still sends the user to the expired-session landing when signOut rejects', async () => {
    const assign = jest.fn()
    ;(globalThis as { window?: unknown }).window = { location: { assign } }
    mockSignOut.mockRejectedValue(new Error('network'))
    try {
      load().signOutExpiredSession()
      await new Promise((resolve) => setImmediate(resolve))
      expect(assign).toHaveBeenCalledWith(SESSION_EXPIRED_REDIRECT)
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })
})
