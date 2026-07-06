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
  },
}
jest.mock('@/lib/temporal', () => ({ getTemporalClient: () => fakeClient }))
jest.mock('@/lib/dal/watchdogHealState', () => ({
  listWatchdogHealState: jest.fn().mockResolvedValue([]),
}))

import { ListWorkflows, GetScheduleHealth, TerminateWorkflow } from './Workflows'

describe('middleman Workflows actions', () => {
  beforeEach(() => {
    requireAdmin.mockReset()
    terminate.mockClear()
    getHandle.mockClear()
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
})
