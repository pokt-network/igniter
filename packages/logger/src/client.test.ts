import type { LogRecord } from '@logtape/logtape'
import { getClientSink, minimalSink, setClientSink } from './client'

const rec = (level: LogRecord['level']): LogRecord =>
  ({
    category: ['t'],
    level,
    message: ['m'],
    rawMessage: 'm',
    properties: {},
    timestamp: Date.now(),
  } as unknown as LogRecord)

function spyConsole() {
  return (['log', 'info', 'debug', 'warn', 'error', 'trace'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => {}),
  )
}
const totalCalls = (spies: jest.SpyInstance[]) =>
  spies.reduce((n, s) => n + s.mock.calls.length, 0)

describe('minimalSink', () => {
  it('drops trace/debug/info (no console output in prod browser)', () => {
    const spies = spyConsole()
    for (const l of ['trace', 'debug', 'info'] as const) minimalSink(rec(l))
    expect(totalCalls(spies)).toBe(0)
    for (const s of spies) s.mockRestore()
  })

  it('emits warning/error/fatal to the console', () => {
    const spies = spyConsole()
    for (const l of ['warning', 'error', 'fatal'] as const) minimalSink(rec(l))
    expect(totalCalls(spies)).toBe(3)
    for (const s of spies) s.mockRestore()
  })
})

describe('setClientSink', () => {
  it('defaults to a no-op and is replaceable (the future-observability seam)', () => {
    expect(typeof getClientSink()).toBe('function')
    const seen: LogRecord[] = []
    setClientSink((r) => {
      seen.push(r)
    })
    getClientSink()(rec('info'))
    expect(seen).toHaveLength(1)
    setClientSink(() => {}) // restore no-op for other tests
  })
})
