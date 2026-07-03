jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const terminate = jest.fn().mockResolvedValue(undefined)
const getHandle = jest.fn(() => ({ terminate }))

function makeInfo(id: string, name = 'ExecuteTransaction') {
  return {
    type: name,
    workflowId: id,
    runId: `${id}-run`,
    taskQueue: 'provider-operations',
    status: { code: 1, name: 'RUNNING' },
    historyLength: 1,
    startTime: new Date('2026-07-01T00:00:00Z'),
    searchAttributes: {},
    raw: {},
  }
}

const fakeClient = {
  workflow: {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        yield makeInfo('wf-a')
        yield makeInfo('wf-b')
      },
    }),
    getHandle,
  },
  schedule: {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          scheduleId: 'GovernanceSync-scheduled',
          state: { paused: false },
          info: { recentActions: [], nextActionTimes: [] },
        }
      },
    }),
  },
}
jest.mock('@/lib/temporal', () => ({ getTemporalClient: () => fakeClient }))
jest.mock('@/lib/dal/watchdogHealState', () => ({
  listWatchdogHealState: jest.fn().mockResolvedValue([
    { scheduleId: 'GovernanceSync-scheduled', unstucks: 4, injectedTriggers: 0, lastHealTriggerAt: null, lastActionCount: 0, unhealthy: true, observedUnhealthy: false },
  ]),
}))

import { ListWorkflows, GetScheduleHealth, TerminateWorkflow } from './Workflows'

describe('provider Workflows actions', () => {
  beforeEach(() => {
    auth.mockReset()
    terminate.mockClear()
    getHandle.mockClear()
    auth.mockResolvedValue({ user: { role: UserRole.Owner } })
  })

  it('ListWorkflows maps list → view-model under an owner', async () => {
    const res = await ListWorkflows({}, { pageIndex: 0, pageSize: 10 })
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data.items.map((v) => v.workflowId)).toEqual(['wf-a', 'wf-b'])
    expect(res.data.items[0].status).toBe('RUNNING')
  })

  it('GetScheduleHealth joins schedule.list with watchdog_heal_state', async () => {
    const res = await GetScheduleHealth()
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data[0].scheduleId).toBe('GovernanceSync-scheduled')
    expect(res.data[0].state).toBe('unhealthy')
    expect(res.data[0].unstucks).toBe(4)
  })

  it('TerminateWorkflow calls handle.terminate with a reason', async () => {
    const res = await TerminateWorkflow('wf-a', 'wf-a-run')
    expect(res.success).toBe(true)
    expect(getHandle).toHaveBeenCalledWith('wf-a', 'wf-a-run')
    expect(terminate).toHaveBeenCalledWith('Terminated by operator from admin UI')
  })

  it('denies a non-owner (unauth)', async () => {
    auth.mockResolvedValue(null)
    const res = await ListWorkflows({}, { pageIndex: 0, pageSize: 10 })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.error.code).toBe('UNAUTHORIZED')
  })
})
