jest.mock('server-only', () => ({}))

const requireAdmin = jest.fn()
jest.mock('@/lib/utils/actions', () => {
  const actionResult = require('@igniter/ui/lib/actionResult')
  return {
    requireAdmin: () => requireAdmin(),
    // Faithful stand-in for the real wrapper: enforces requireAdmin and maps to
    // the shared ActionResult<T> shape (see @/lib/utils/actions).
    withRequireOwner: async (action: () => Promise<unknown>) => {
      try {
        await requireAdmin()
        return actionResult.success(await action())
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred'
        const code =
          message === 'Unauthorized' || message === 'Not logged in'
            ? 'UNAUTHORIZED'
            : 'INTERNAL_ERROR'
        return actionResult.error(code, message)
      }
    },
  }
})

const terminate = jest.fn().mockResolvedValue(undefined)
const getHandle = jest.fn(() => ({ terminate }))

function makeInfo(id: string) {
  return {
    type: 'GovernanceSync',
    workflowId: id,
    runId: `${id}-run`,
    taskQueue: 'middleman-operations',
    status: { code: 1, name: 'RUNNING' },
    historyLength: 1,
    startTime: new Date('2026-07-01T00:00:00Z'),
    searchAttributes: {},
    raw: {},
  }
}

const schedulePause = jest.fn().mockResolvedValue(undefined)
const scheduleUnpause = jest.fn().mockResolvedValue(undefined)
const scheduleDelete = jest.fn().mockResolvedValue(undefined)
const scheduleGetHandle = jest.fn(() => ({
  describe: async () => ({
    scheduleId: 'GovernanceSync-scheduled',
    state: { paused: true },
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

const fakeClient = {
  workflow: {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        yield makeInfo('wf-a')
      },
    }),
    getHandle,
  },
  schedule: {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          scheduleId: 'GovernanceSync-scheduled',
          state: { paused: true },
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
  listWatchdogHealState: jest.fn().mockResolvedValue([]),
  resetWatchdogRecreations: jest.fn().mockResolvedValue(undefined),
}))
import { resetWatchdogRecreations } from '@/lib/dal/watchdogHealState'
const resetRecreations = resetWatchdogRecreations as jest.Mock

import {
  ListWorkflows,
  GetScheduleHealth,
  TerminateWorkflow,
  PauseSchedule,
  ResumeSchedule,
  RecreateSchedule,
} from './Workflows'

describe('middleman Workflows actions', () => {
  beforeEach(() => {
    requireAdmin.mockReset()
    terminate.mockClear()
    getHandle.mockClear()
    schedulePause.mockClear()
    scheduleUnpause.mockClear()
    scheduleDelete.mockClear()
    resetRecreations.mockClear()
    scheduleDelete.mockResolvedValue(undefined)
    schedulePause.mockResolvedValue(undefined)
    requireAdmin.mockResolvedValue(undefined)
  })

  it('ListWorkflows returns ActionResult success with mapped data', async () => {
    const res = await ListWorkflows({}, { pageIndex: 0, pageSize: 10 })
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data.items[0].workflowId).toBe('wf-a')
  })

  it('GetScheduleHealth reports paused schedules (empty health)', async () => {
    const res = await GetScheduleHealth()
    expect(res.success).toBe(true)
    if (!res.success) throw new Error('expected success')
    expect(res.data[0].state).toBe('paused')
  })

  it('TerminateWorkflow calls handle.terminate', async () => {
    const res = await TerminateWorkflow('wf-a', 'wf-a-run')
    expect(res.success).toBe(true)
    expect(getHandle).toHaveBeenCalledWith('wf-a', 'wf-a-run')
    expect(terminate).toHaveBeenCalledWith('Terminated by operator from admin UI')
  })

  it('denies when requireAdmin throws Unauthorized', async () => {
    requireAdmin.mockRejectedValue(new Error('Unauthorized'))
    const res = await ListWorkflows({}, { pageIndex: 0, pageSize: 10 })
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.error.message).toBe('Unauthorized')
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

  it('RecreateSchedule resets the recreate breaker BEFORE deleting (H1)', async () => {
    const order: string[] = []
    resetRecreations.mockImplementationOnce(async () => { order.push('reset') })
    scheduleDelete.mockImplementationOnce(async () => { order.push('delete') })
    const res = await RecreateSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(true)
    expect(resetRecreations).toHaveBeenCalledWith('GovernanceSync-scheduled')
    expect(order).toEqual(['reset', 'delete'])
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
    requireAdmin.mockRejectedValue(new Error('Unauthorized'))
    const res = await RecreateSchedule('GovernanceSync-scheduled')
    expect(res.success).toBe(false)
    if (res.success) throw new Error('expected failure')
    expect(res.error.message).toBe('Unauthorized')
  })
})
