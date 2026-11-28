import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from './sessionExpired'

describe('isSessionExpiredError', () => {
  it('matches the Error the Next client raises for the middleware 401 body', () => {
    expect(isSessionExpiredError(new Error(SESSION_EXPIRED_MESSAGE))).toBe(true)
  })

  it.each([
    ['another error', new Error('Forbidden')],
    ['a message that only contains it', new Error('Session expired soon')],
    ['the bare string', SESSION_EXPIRED_MESSAGE],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isSessionExpiredError(value)).toBe(false)
  })
})
