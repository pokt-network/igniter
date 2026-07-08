jest.mock('server-only', () => ({}))

import { UserRole } from '@igniter/db/provider/enums'

const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const terminate = jest.fn().mockResolvedValue(undefined)
const getHandle = jest.fn(() => ({ terminate }))

const schedulePause = jest.fn().mockResolvedValue(undefined)
const scheduleUnpause = jest.fn().mockResolvedValue(undefined)
const scheduleDelete = jest.fn().mockResolvedValue(undefined)
const scheduleGetHandle = jest.fn(() => ({
  describe: async () => ({
    scheduleId: 'GovernanceSync-scheduled',
    state: { paused: false },
    spec: { intervals: [] },
    info: {
      recentActions: [],
      nextActionTimes: [],
      runningActions: [],
      numActionsTaken: 0,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    },
  }),
  pause: schedulePause,
  unpause: scheduleUnpause,
  delete: scheduleDelete,
}))

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
    // GetScheduleHealth describe()s each schedule for running-actions-aware liveness.
    getHandle: scheduleGetHandle,
  },
}
jest.mock('@/lib/temporal', () => ({ getTemporalClient: () => fakeClient }))
jest.mock('@/lib/dal/watchdogHealState', () => ({
  listWatchdogHealState: jest.fn().mockResolvedValue([
    { scheduleId: 'GovernanceSync-scheduled', unstucks: 4, injectedTriggers: 0, lastHealTriggerAt: null, lastActionCount: 0, unhealthy: true, observedUnhealthy: false },
  ]),
}))

import {
  ListWorkflows,
  GetScheduleHealth,
  TerminateWorkflow,
  PauseSchedule,
  ResumeSchedule,
  RecreateSchedule,
} from './Workflows'

describe('provider Workflows actions', () => {
  beforeEach(() => {
    auth.mockReset()
    terminate.mockClear()
    getHandle.mockClear()
    schedulePause.mockClear()
    scheduleUnpause.mockClear()
    scheduleDelete.mockClear()
    scheduleDelete.mockResolvedValue(undefined)
    schedulePause.mockResolvedValue(undefined)
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

  it('PauseSchedule pauses with a default operator note', async () => {
    const res = await PauseSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(true)
    expect(schedulePause).toHaveBeenCalledWith('Paused by operator from admin UI')
  })

  it('PauseSchedule forwards an explicit note', async () => {
    const res = await PauseSchedule('GovernanceSync-scheduled', 'ops window')
    expect(res.success).toBe(true)
    expect(schedulePause).toHaveBeenCalledWith('ops window')
  })

  it('ResumeSchedule unpauses', async () => {
    const res = await ResumeSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(true)
    expect(scheduleUnpause).toHaveBeenCalledWith('Resumed by operator from admin UI')
  })

  it('RecreateSchedule deletes the schedule', async () => {
    const res = await RecreateSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(true)
    expect(scheduleDelete).toHaveBeenCalledTimes(1)
  })

  it('RecreateSchedule treats NOT_FOUND as success (idempotent)', async () => {
    scheduleDelete.mockRejectedValueOnce(Object.assign(new Error('schedule not found'), { code: 5 }))
    const res = await RecreateSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(true)
  })

  it('PauseSchedule on a corrupt scheduler workflow suggests Recreate', async () => {
    schedulePause.mockRejectedValueOnce(Object.assign(new Error('Failed to pause schedule'), {
      cause: Object.assign(new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'), { code: 9 }),
    }))
    const res = await PauseSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.error.message).toMatch(/recreate/i)
  })

  it('schedule actions deny a non-owner', async () => {
    auth.mockResolvedValue(null)
    const res = await RecreateSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.error.code).toBe('UNAUTHORIZED')
  })
})
