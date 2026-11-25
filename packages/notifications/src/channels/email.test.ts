// SMTP connections are pinned to a guard-vetted IP (no DNS-rebinding window)
// and restricted to the standard submission/relay ports.
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { lookup } from 'node:dns/promises'
import { ALLOWED_SMTP_PORTS, pinnedSmtpGetSocket } from './email'

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
const mockLookup = lookup as jest.MockedFunction<typeof lookup>

class FakeSocket extends EventEmitter {
  setTimeout = jest.fn()
  destroy = jest.fn()
}

function runGetSocket(host: string, port: number): Promise<{ err: Error | null; opts?: unknown }> {
  return new Promise((resolve) => {
    pinnedSmtpGetSocket({ host, port })({}, (err, opts) => resolve({ err, opts }))
  })
}

let connectSpy: jest.SpyInstance
let socket: FakeSocket

beforeEach(() => {
  jest.clearAllMocks()
  socket = new FakeSocket()
  connectSpy = jest.spyOn(net, 'connect').mockImplementation(((..._args: unknown[]) => {
    setImmediate(() => socket.emit('connect'))
    return socket
  }) as never)
})
afterEach(() => connectSpy.mockRestore())

describe('pinnedSmtpGetSocket', () => {
  it('allows only ports 25, 465, 587, 2525', () => {
    expect([...ALLOWED_SMTP_PORTS].sort((a, b) => a - b)).toEqual([25, 465, 587, 2525])
  })

  it('connects to the resolved public IP, not the hostname', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    const { err, opts } = await runGetSocket('smtp.example.com', 587)
    expect(err).toBeNull()
    expect(connectSpy).toHaveBeenCalledWith({ host: '93.184.216.34', port: 587 })
    expect(opts).toEqual({ connection: socket })
  })

  it('refuses when the connect-time resolution returns an internal address (rebinding)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never)
    const { err } = await runGetSocket('smtp.example.com', 587)
    expect(err?.message).toBe('Destination address is not allowed')
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('refuses a non-SMTP port before resolving', async () => {
    const { err } = await runGetSocket('smtp.example.com', 6379)
    expect(err?.message).toBe('SMTP port 6379 is not allowed')
    expect(mockLookup).not.toHaveBeenCalled()
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('allows another port for an operator-trusted internal host (localnet mailpit:1025)', async () => {
    const prev = process.env.NOTIFICATION_EGRESS_ALLOWLIST
    process.env.NOTIFICATION_EGRESS_ALLOWLIST = '10.0.0.0/8'
    try {
      // The allowlist is cached per module instance, so load a fresh one that sees the env.
      let fresh!: { getSocket: typeof pinnedSmtpGetSocket; lookup: jest.MockedFunction<typeof lookup> }
      jest.isolateModules(() => {
        fresh = { getSocket: require('./email').pinnedSmtpGetSocket, lookup: require('node:dns/promises').lookup }
      })
      fresh.lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }] as never)
      const { err } = await new Promise<{ err: Error | null }>((resolve) => {
        fresh.getSocket({ host: 'mailpit', port: 1025 })({}, (e) => resolve({ err: e }))
      })
      expect(err).toBeNull()
      expect(connectSpy).toHaveBeenCalledWith({ host: '10.1.2.3', port: 1025 })
    } finally {
      if (prev === undefined) delete process.env.NOTIFICATION_EGRESS_ALLOWLIST
      else process.env.NOTIFICATION_EGRESS_ALLOWLIST = prev
    }
  })

  it('surfaces a socket error as a callback error', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    connectSpy.mockImplementation(((..._args: unknown[]) => {
      setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')))
      return socket
    }) as never)
    const { err } = await runGetSocket('smtp.example.com', 465)
    expect(err?.message).toBe('ECONNREFUSED')
    expect(socket.destroy).toHaveBeenCalled()
  })
})
