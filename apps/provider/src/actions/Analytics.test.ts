jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const start = jest.fn()
const describeWorkflow = jest.fn()
jest.mock('@/lib/temporal', () => ({
  getTemporalClient: () => ({ workflow: { start, getHandle: () => ({ describe: () => describeWorkflow() }) } }),
  getTemporalConfig: () => ({ namespace: 'provider', taskQueue: 'provider-operations' }),
}))

const getApplicationSettings = jest.fn()
jest.mock('@/lib/dal/applicationSettings', () => ({ getApplicationSettings: () => getApplicationSettings() }))

const listAnalyticsKeys = jest.fn()
const analyticsDayCoverage = jest.fn()
const listAnalyticsServices = jest.fn()
const analyticsHasOtherSuppliers = jest.fn()
const getAnalyticsSession = jest.fn()
jest.mock('@/lib/dal/analytics', () => ({
  analyticsOldestDay: async () => '2026-10-20',
  ANALYTICS_BREAKDOWN_DIMENSIONS: ['service'],
  listAnalyticsKeys: () => listAnalyticsKeys(),
  analyticsDayCoverage: (...a: unknown[]) => analyticsDayCoverage(...a),
  listAnalyticsServices: (...a: unknown[]) => listAnalyticsServices(...a),
  analyticsHasOtherSuppliers: (...a: unknown[]) => analyticsHasOtherSuppliers(...a),
  getAnalyticsSession: (...a: unknown[]) => getAnalyticsSession(...a),
}))

import { GetAnalyticsBackfillStatus, GetAnalyticsHeader, GetAnalyticsSession, StartAnalyticsBackfill } from './Analytics'

function alreadyStarted() {
  const e = new Error('Workflow execution already started')
  e.name = 'WorkflowExecutionAlreadyStartedError'
  return e
}

describe('StartAnalyticsBackfill', () => {
  beforeEach(() => {
    auth.mockReset()
    start.mockReset()
    auth.mockResolvedValue({ user: { role: UserRole.Owner } })
  })

  it('starts AnalyticsBackfill under its fixed workflow id', async () => {
    start.mockResolvedValue({})
    const res = await StartAnalyticsBackfill()
    expect(res).toEqual({ success: true, data: { started: true } })
    expect(start).toHaveBeenCalledWith('AnalyticsBackfill', {
      taskQueue: 'provider-operations',
      workflowId: 'AnalyticsBackfill',
      args: [],
    })
  })

  it('a second click while one is running is a no-op', async () => {
    start.mockResolvedValueOnce({}).mockRejectedValueOnce(alreadyStarted())
    await StartAnalyticsBackfill()
    const res = await StartAnalyticsBackfill()
    expect(res).toEqual({ success: true, data: { started: false } })
    expect(start.mock.calls.map((c) => c[1].workflowId)).toEqual(['AnalyticsBackfill', 'AnalyticsBackfill'])
  })

  it('denies a non-owner', async () => {
    auth.mockResolvedValue({ user: { role: UserRole.User } })
    const res = await StartAnalyticsBackfill()
    expect(res.success).toBe(false)
    expect(start).not.toHaveBeenCalled()
  })
})

describe('GetAnalyticsHeader', () => {
  const key = (address: string) => ({
    address, ownerAddress: null, retiredAt: null,
    services: [{ serviceId: 'akash', endpoints: [{ url: `https://akash.relay.nodefleet.net` }] }],
  })

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date('2026-10-25T10:00:00Z'))
    auth.mockResolvedValue({ user: { role: UserRole.Owner } })
    getApplicationSettings.mockResolvedValue({ analyticsDayRetentionDays: 3 })
    listAnalyticsKeys.mockResolvedValue([key('pokt1a'), key('pokt1b')])
    listAnalyticsServices.mockResolvedValue(['akash'])
  })
  afterEach(() => jest.useRealTimers())

  it('reports the missing supplier-days and the coverage', async () => {
    analyticsDayCoverage.mockResolvedValue([
      { day: '2026-10-24', states: 2, closed: true },
      { day: '2026-10-25', states: 1, closed: false },
    ])
    const res = await GetAnalyticsHeader({ days: 90, services: null })
    if (!res.success) throw new Error('expected success')
    expect(analyticsDayCoverage).toHaveBeenCalledWith('2026-10-23', '2026-10-25', ['pokt1a', 'pokt1b'])
    expect(res.data).toMatchObject({
      from: '2026-10-23', to: '2026-10-25', suppliers: 2, services: 1,
      lastClosedDay: '2026-10-24', openDays: 1,
      missing: { pairs: 3, days: 2 },
    })
  })

  it('counts every never-synced supplier-day of the period', async () => {
    analyticsDayCoverage.mockResolvedValue([])
    const res = await GetAnalyticsHeader({ days: 7, services: null })
    if (!res.success) throw new Error('expected success')
    expect(res.data.missing).toEqual({ pairs: 6, days: 3 })
  })
})

describe('GetAnalyticsBackfillStatus', () => {
  beforeEach(() => auth.mockResolvedValue({ user: { role: UserRole.Owner } }))

  it('is running only while the latest run is RUNNING', async () => {
    for (const [name, running] of [['RUNNING', true], ['COMPLETED', false], ['FAILED', false], ['TERMINATED', false]] as const) {
      describeWorkflow.mockResolvedValue({ status: { name } })
      const res = await GetAnalyticsBackfillStatus()
      if (!res.success) throw new Error('expected success')
      expect(res.data.running).toBe(running)
    }
  })

  it('a backfill never started is not running', async () => {
    describeWorkflow.mockRejectedValue(Object.assign(new Error('not found'), { name: 'WorkflowNotFoundError' }))
    const res = await GetAnalyticsBackfillStatus()
    if (!res.success) throw new Error('expected success')
    expect(res.data.running).toBe(false)
  })
})

describe('GetAnalyticsSession', () => {
  const key = (address: string, url: string) => ({
    address, ownerAddress: null, retiredAt: null, services: [{ serviceId: 'akash', endpoints: [{ url }] }],
  })

  beforeEach(() => {
    auth.mockResolvedValue({ user: { role: UserRole.Owner } })
    getApplicationSettings.mockResolvedValue({ analyticsDayRetentionDays: 90 })
    listAnalyticsKeys.mockResolvedValue([key('pokt1a', 'https://a.nodefleet.net'), key('pokt1b', 'https://b.other.net')])
    getAnalyticsSession.mockReset().mockResolvedValue(null)
  })

  it('reads the session over every verified supplier of the provider, whatever their endpoints', async () => {
    analyticsHasOtherSuppliers.mockResolvedValue(false)
    await GetAnalyticsSession({ days: 7, services: ['akash'] }, 's1')
    const [filter, sessionId] = getAnalyticsSession.mock.calls[0]!
    expect(sessionId).toBe('s1')
    expect(filter).toEqual(expect.objectContaining({ suppliers: ['pokt1a', 'pokt1b'], services: ['akash'], wholeSessions: true }))
    expect(filter).not.toHaveProperty('pairs')
  })

  it('reads sessions from analytics_session alone only when no stored supplier is outside the scope', async () => {
    analyticsHasOtherSuppliers.mockResolvedValue(true)
    await GetAnalyticsSession({ days: 7, services: null }, 's1')
    expect(getAnalyticsSession.mock.calls[0]![0]).toMatchObject({ suppliers: ['pokt1a', 'pokt1b'], wholeSessions: false })
    analyticsHasOtherSuppliers.mockResolvedValue(false)
    await GetAnalyticsSession({ days: 7, services: null }, 's1')
    expect(getAnalyticsSession.mock.calls[1]![0]).toMatchObject({ wholeSessions: true })
  })
})
