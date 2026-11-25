import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const connectMock = jest.fn(async (_opts: unknown) => ({ close: jest.fn() }))
jest.mock('@temporalio/worker', () => ({
  NativeConnection: { connect: (opts: unknown) => connectMock(opts) },
  Runtime: { install: jest.fn() },
  Worker: { create: jest.fn(async () => ({ shutdown: jest.fn() })) },
}))
jest.mock('@igniter/logger/temporal', () => ({ getTemporalLogger: () => ({}) }))

import { getApiKey, getTLSConfig } from '@/connectionOptions'
import { getWorker } from '@/worker'

const logger = { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any

const ENV_KEYS = [
  'TEMPORAL_TLS_ENABLED', 'TEMPORAL_CLIENT_CERT_PATH', 'TEMPORAL_CLIENT_KEY_PATH',
  'TEMPORAL_SERVER_ROOT_CA_PATH', 'TEMPORAL_TLS_SERVER_NAME', 'TEMPORAL_API_KEY',
  'TEMPORAL_URL', 'TEMPORAL_NAMESPACE', 'TEMPORAL_TASK_QUEUE',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  connectMock.mockClear()
  delete (global as any).temporalWorker
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function writeCerts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'))
  const crt = path.join(dir, 'c.crt'); fs.writeFileSync(crt, 'CRT')
  const key = path.join(dir, 'c.key'); fs.writeFileSync(key, 'KEY')
  return { crt, key }
}

describe('getTLSConfig / getApiKey', () => {
  it('returns undefined when TLS and API key env vars are unset (default unchanged)', () => {
    expect(getTLSConfig(logger)).toBeUndefined()
    expect(getApiKey()).toBeUndefined()
  })

  it('treats a blank TEMPORAL_API_KEY as unset', () => {
    process.env.TEMPORAL_API_KEY = '   '
    expect(getApiKey()).toBeUndefined()
  })

  it('throws when TLS is enabled without cert/key paths', () => {
    process.env.TEMPORAL_TLS_ENABLED = 'true'
    expect(() => getTLSConfig(logger)).toThrow('Missing TLS client cert/key paths')
  })
})

describe('getWorker NativeConnection options', () => {
  beforeEach(() => {
    process.env.TEMPORAL_URL = 'temporal:7233'
    process.env.TEMPORAL_NAMESPACE = 'ns'
    process.env.TEMPORAL_TASK_QUEUE = 'q'
  })

  it('connects with no TLS and no apiKey by default', async () => {
    await getWorker(logger, { workflowsPath: __filename })
    expect(connectMock).toHaveBeenCalledWith({ address: 'temporal:7233', tls: undefined, apiKey: undefined })
  })

  it('passes the client TLS config and TEMPORAL_API_KEY to the worker connection', async () => {
    const { crt, key } = writeCerts()
    process.env.TEMPORAL_TLS_ENABLED = 'true'
    process.env.TEMPORAL_CLIENT_CERT_PATH = crt
    process.env.TEMPORAL_CLIENT_KEY_PATH = key
    process.env.TEMPORAL_TLS_SERVER_NAME = 'temporal.internal'
    process.env.TEMPORAL_API_KEY = 'secret-key'
    await getWorker(logger, { workflowsPath: __filename })
    const opts = connectMock.mock.calls[0]![0] as any
    expect(opts.address).toBe('temporal:7233')
    expect(opts.apiKey).toBe('secret-key')
    expect(opts.tls.clientCertPair.crt.toString()).toBe('CRT')
    expect(opts.tls.clientCertPair.key.toString()).toBe('KEY')
    expect(opts.tls.serverNameOverride).toBe('temporal.internal')
  })
})
