const fatal = jest.fn()
jest.mock('@igniter/logger', () => ({
  configureLogging: jest.fn(async () => undefined),
  getLogger: () => ({ fatal }),
}))

import { register } from './instrumentation'

const saved = { ...process.env }
const good = { NEXT_RUNTIME: 'nodejs', AUTH_SECRET: 's'.repeat(32), APP_IDENTITY: 'abc', ENCRYPTION_KEY: 'ab'.repeat(32), }

let exit: jest.SpyInstance
beforeEach(() => {
  exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
})

afterEach(() => {
  process.env = { ...saved }
  exit.mockRestore()
  jest.clearAllMocks()
})

describe('register (server start)', () => {
  it('starts with acceptable secrets', async () => {
    Object.assign(process.env, good)
    await expect(register()).resolves.toBeUndefined()
  })

  it.each([
    ['empty', ''],
    ['a CHANGEME placeholder', 'CHANGEME_AUTH_SECRET_PLEASE_CHANGEME_NOW'],
    ['shorter than 32 bytes', 'short-secret'],
  ])('refuses to start with an AUTH_SECRET that is %s, without logging its value', async (_name, value) => {
    Object.assign(process.env, good, { AUTH_SECRET: value })
    await expect(register()).rejects.toThrow('process.exit(1)')
    expect(fatal).toHaveBeenCalledWith(expect.any(String), { problems: [expect.stringContaining('AUTH_SECRET')] })
    if (value) expect(JSON.stringify(fatal.mock.calls)).not.toContain(value)
  })

  it('refuses to start with an ENCRYPTION_KEY that is not 32 hex bytes', async () => {
    Object.assign(process.env, good, { ENCRYPTION_KEY: 'CHANGEME' })
    await expect(register()).rejects.toThrow('process.exit(1)')
    expect(fatal).toHaveBeenCalledWith(expect.any(String), { problems: [expect.stringContaining('ENCRYPTION_KEY')] })
  })

  it('does not check in the edge runtime (no process to stop there)', async () => {
    Object.assign(process.env, good, { NEXT_RUNTIME: 'edge', AUTH_SECRET: '' })
    await expect(register()).resolves.toBeUndefined()
  })
})
