import { configure, reset, type LogRecord } from '@logtape/logtape'
import { getTemporalLogger } from './temporal'

let buffer: LogRecord[]

beforeEach(async () => {
  buffer = []
  await configure({
    reset: true,
    sinks: { buffer: buffer.push.bind(buffer) },
    loggers: [
      { category: [], sinks: ['buffer'], lowestLevel: 'trace' },
      // Verified against installed @logtape/logtape@2.2.1 (see index.test.ts): configure()
      // always emits an info-level "LogTape loggers are configured" meta diagnostic that,
      // left unconfigured, inherits the root [] logger's sinks/level and lands in `buffer`
      // ahead of the record(s) under test.
      { category: ['logtape', 'meta'], sinks: ['buffer'], lowestLevel: 'warning' },
    ],
  })
})

afterEach(async () => {
  await reset()
})

describe('getTemporalLogger', () => {
  it('maps Temporal WARN to LogTape warning and forwards meta as properties', () => {
    const t = getTemporalLogger(['temporal'])
    t.warn('slow activity', { activityId: 'a1', workflowId: 'w1', runId: 'r1', taskQueue: 'q' })
    expect(buffer[0]!.level).toBe('warning')
    expect(buffer[0]!.properties).toMatchObject({
      activity_id: 'a1', workflow_id: 'w1', run_id: 'r1', task_queue: 'q',
    })
  })

  it('maps each level via log()', () => {
    const t = getTemporalLogger(['temporal'])
    t.log('TRACE', 'a'); t.log('DEBUG', 'b'); t.log('INFO', 'c')
    t.log('WARN', 'd'); t.log('ERROR', 'e')
    expect(buffer.map((r) => r.level)).toEqual(['trace', 'debug', 'info', 'warning', 'error'])
  })

  it('preserves message as the rendered text', () => {
    getTemporalLogger(['temporal']).info('worker created')
    expect(buffer[0]!.message.join('')).toBe('worker created')
  })

  // F4/F5/F10/F13/F14: Temporal messages are FOREIGN free text and can contain
  // literal braces (JSON blobs). LogTape would parse `{...}` as a placeholder and
  // render unmatched keys as `undefined`. The bridge escapes braces so a message
  // survives verbatim.
  it('renders a foreign message containing brace-JSON verbatim (no undefined)', () => {
    getTemporalLogger(['temporal']).error('activity failed: {"json":"blob","n":1}')
    const rendered = buffer[0]!.message.join('')
    expect(rendered).toBe('activity failed: {"json":"blob","n":1}')
    expect(rendered).not.toContain('undefined')
  })
})
