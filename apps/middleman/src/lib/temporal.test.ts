const lazyMock = jest.fn((_opts: unknown) => ({}))
jest.mock('@temporalio/client', () => ({
  Connection: { lazy: (opts: unknown) => lazyMock(opts) },
  Client: jest.fn().mockImplementation(() => ({})),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const KEYS = ['TEMPORAL_TLS_ENABLED', 'TEMPORAL_CLIENT_CERT_PATH', 'TEMPORAL_CLIENT_KEY_PATH', 'TEMPORAL_SERVER_ROOT_CA_PATH', 'TEMPORAL_TLS_SERVER_NAME', 'TEMPORAL_API_KEY']
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  lazyMock.mockClear()
  jest.resetModules()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('lib/temporal client connection options', () => {
  it('connects without TLS or apiKey when the env vars are unset', () => {
    require('./temporal')
    expect(lazyMock).toHaveBeenCalledWith(expect.objectContaining({ tls: undefined, apiKey: undefined }))
  })

  it('passes TLS cert pair and TEMPORAL_API_KEY when configured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'))
    fs.writeFileSync(path.join(dir, 'c.crt'), 'CRT')
    fs.writeFileSync(path.join(dir, 'c.key'), 'KEY')
    process.env.TEMPORAL_TLS_ENABLED = 'true'
    process.env.TEMPORAL_CLIENT_CERT_PATH = path.join(dir, 'c.crt')
    process.env.TEMPORAL_CLIENT_KEY_PATH = path.join(dir, 'c.key')
    process.env.TEMPORAL_API_KEY = 'k1'
    require('./temporal')
    const opts = lazyMock.mock.calls[0]![0] as any
    expect(opts.apiKey).toBe('k1')
    expect(opts.tls.clientCertPair.crt.toString()).toBe('CRT')
    expect(opts.tls.clientCertPair.key.toString()).toBe('KEY')
  })

  it('throws when TLS is enabled without cert/key paths', () => {
    process.env.TEMPORAL_TLS_ENABLED = 'true'
    expect(() => require('./temporal')).toThrow(/TEMPORAL_CLIENT_CERT_PATH/)
  })
})
