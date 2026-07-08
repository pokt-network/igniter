import { ScheduleAlreadyRunning } from '@temporalio/client'
import { ensureSchedule, isCorruptSchedule } from '@/scheduleWatchdog'
import type { WatchdogEntry } from '@/scheduleWatchdog'

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never

const entry: WatchdogEntry = {
  scheduleId: 'GovernanceSync-scheduled',
  workflowType: 'GovernanceSync',
  taskQueue: 'default',
  args: [{ a: 1 }],
  interval: '30s',
  intervalMs: 30_000,
  missedFirings: 5,
  minAgeMs: 180_000,
  minGraceMs: 90_000,
  graceCapMs: 600_000,
}

function notFound() {
  return Object.assign(new Error('schedule not found'), { code: 5 })
}

/**
 * Real SDK shape: ScheduleClient.rethrowGrpcError wraps the gRPC error as
 * ServiceError('Failed to describe schedule', { cause }) — the grpc code and
 * details live ONLY on the cause, never on the thrown error itself.
 */
function corruptSchedule() {
  return Object.assign(new Error('Failed to describe schedule'), {
    cause: Object.assign(
      new Error('9 FAILED_PRECONDITION: Unable to query workflow due to Workflow Task in failed state.'),
      { code: 9 },
    ),
  })
}

function fakeClient(handle: Record<string, unknown>, createImpl?: jest.Mock) {
  return {
    schedule: {
      getHandle: () => handle,
      create: createImpl ?? jest.fn(),
    },
  } as never
}

describe('ensureSchedule', () => {
  it('creates the schedule when describe() reports NOT_FOUND', async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const handle = { describe: jest.fn().mockRejectedValue(notFound()), update: jest.fn() }
    await ensureSchedule(fakeClient(handle, create), entry, logger)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({
      scheduleId: 'GovernanceSync-scheduled',
      action: { type: 'startWorkflow', workflowType: 'GovernanceSync', taskQueue: 'default', args: [{ a: 1 }] },
    })
  })

  it('swallows ScheduleAlreadyRunning on create (race)', async () => {
    const create = jest.fn().mockRejectedValue(new ScheduleAlreadyRunning('dup', 'GovernanceSync-scheduled'))
    const handle = { describe: jest.fn().mockRejectedValue(notFound()), update: jest.fn() }
    await expect(ensureSchedule(fakeClient(handle, create), entry, logger)).resolves.toBeUndefined()
  })

  it('updates in place when args/interval drift', async () => {
    const update = jest.fn().mockResolvedValue(undefined)
    const handle = {
      describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 60_000 }] } }),
      update,
    }
    await ensureSchedule(fakeClient(handle), entry, logger)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('no-ops when config already matches', async () => {
    const update = jest.fn()
    const handle = {
      describe: jest.fn().mockResolvedValue({ action: { args: [{ a: 1 }] }, spec: { intervals: [{ every: 30_000 }] } }),
      update,
    }
    await ensureSchedule(fakeClient(handle), entry, logger)
    expect(update).not.toHaveBeenCalled()
  })

  it('re-throws a definitive non-NOT_FOUND describe() error', async () => {
    // code 7 = PERMISSION_DENIED: a real misconfiguration that must crash-loop, not be swallowed.
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 7 })), update: jest.fn() }
    await expect(ensureSchedule(fakeClient(handle), entry, logger)).rejects.toThrow('boom')
  })

  it('tolerates a transient describe() error (no crash-loop, #229)', async () => {
    // code 14 = UNAVAILABLE: a transient RPC blip must not abort bootstrap.
    const handle = { describe: jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 })), update: jest.fn() }
    await expect(ensureSchedule(fakeClient(handle), entry, logger)).resolves.toBeUndefined()
  })

  it('tolerates a transient update() failure during drift (#229)', async () => {
    const update = jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 14 }))
    const handle = {
      describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 60_000 }] } }),
      update,
    }
    await expect(ensureSchedule(fakeClient(handle), entry, logger)).resolves.toBeUndefined()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('creates fresh when the schedule is deleted between describe() and drift update() (race)', async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const update = jest.fn().mockRejectedValue(notFound())
    const handle = {
      describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 60_000 }] } }),
      update,
    }
    await ensureSchedule(fakeClient(handle, create), entry, logger)
    expect(update).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ scheduleId: 'GovernanceSync-scheduled' })
  })

  it('corrupt scheduler workflow (WFT failed): deletes and recreates instead of crash-looping', async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const del = jest.fn().mockResolvedValue(undefined)
    const handle = { describe: jest.fn().mockRejectedValue(corruptSchedule()), update: jest.fn(), delete: del }
    await expect(ensureSchedule(fakeClient(handle, create), entry, logger)).resolves.toBeUndefined()
    expect(del).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ scheduleId: 'GovernanceSync-scheduled' })
  })

  it('corrupt schedule: a failing delete() still never aborts bootstrap', async () => {
    const create = jest.fn()
    const del = jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: 13 }))
    const handle = { describe: jest.fn().mockRejectedValue(corruptSchedule()), update: jest.fn(), delete: del }
    await expect(ensureSchedule(fakeClient(handle, create), entry, logger)).resolves.toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('corrupt during drift update(): deletes and recreates (same reaction as describe)', async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const del = jest.fn().mockResolvedValue(undefined)
    const handle = {
      describe: jest.fn().mockResolvedValue({ action: { args: [] }, spec: { intervals: [{ every: 60_000 }] } }),
      update: jest.fn().mockRejectedValue(corruptSchedule()),
      delete: del,
    }
    await expect(ensureSchedule(fakeClient(handle, create), entry, logger)).resolves.toBeUndefined()
    expect(del).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('tolerates a transient describe() error wrapped in ServiceError (code on cause, #229)', async () => {
    const wrapped = Object.assign(new Error('Failed to describe schedule'), {
      cause: Object.assign(new Error('14 UNAVAILABLE: connection refused'), { code: 14 }),
    })
    const handle = { describe: jest.fn().mockRejectedValue(wrapped), update: jest.fn() }
    await expect(ensureSchedule(fakeClient(handle), entry, logger)).resolves.toBeUndefined()
  })
})

describe('isCorruptSchedule', () => {
  it('matches FAILED_PRECONDITION + WFT-failed message on the cause chain', () => {
    expect(isCorruptSchedule(corruptSchedule())).toBe(true)
  })

  it('matches when code and message are on the error itself (unwrapped)', () => {
    const e = Object.assign(new Error('Unable to query workflow due to Workflow Task in failed state.'), { code: 9 })
    expect(isCorruptSchedule(e)).toBe(true)
  })

  it('rejects FAILED_PRECONDITION with an unrelated message (not every code 9 is corrupt)', () => {
    const e = Object.assign(new Error('9 FAILED_PRECONDITION: namespace is not active'), { code: 9 })
    expect(isCorruptSchedule(e)).toBe(false)
  })

  it('rejects a WFT-failed message under a different grpc code', () => {
    const e = Object.assign(new Error('Unable to query workflow due to Workflow Task in failed state.'), { code: 5 })
    expect(isCorruptSchedule(e)).toBe(false)
  })
})
