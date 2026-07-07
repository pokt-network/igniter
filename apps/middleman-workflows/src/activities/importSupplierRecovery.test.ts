import { importSupplierRecoveryActivities } from './importSupplierRecovery'
import { dispatchUserNotification } from '@/lib/notifications/dispatch'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'

// @temporalio/activity `log` requires an activity context; stub it so the
// activity methods can run under plain jest.
jest.mock('@temporalio/activity', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// Spy on the fire-and-forget user notification so we can assert the trigger.
jest.mock('@/lib/notifications/dispatch', () => ({
  dispatchUserNotification: jest.fn().mockResolvedValue(undefined),
}))

const mockDispatch = dispatchUserNotification as jest.MockedFunction<typeof dispatchUserNotification>

function makeActivities(markCompletedResult: unknown, markFailedResult: unknown) {
  const markCompleted = jest.fn().mockResolvedValue(markCompletedResult)
  const markFailed = jest.fn().mockResolvedValue(markFailedResult)
  const dal = {
    importSupplierAttempts: { markCompleted, markFailed },
  } as unknown as DAL
  const providerService = {} as ProviderService
  return {
    activities: importSupplierRecoveryActivities(dal, providerService),
    markCompleted,
    markFailed,
  }
}

beforeEach(() => jest.clearAllMocks())

// Trigger coverage for the import_result user notification.
describe('import_result notification trigger', () => {
  it('markAttemptCompleted fires import_result/completed with the supplier count', async () => {
    const { activities } = makeActivities({ userIdentity: 'pokt1user' }, null)

    await activities.markAttemptCompleted(7, ['a1', 'a2', 'a3'])

    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      type: 'import_result',
      ownerIdentity: 'pokt1user',
      metadata: { outcome: 'completed', supplierCount: 3 },
    })
  })

  it('markAttemptFailed fires import_result/failed with the error', async () => {
    const { activities } = makeActivities(null, { userIdentity: 'pokt1user' })

    await activities.markAttemptFailed(7, 'boom')

    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      type: 'import_result',
      ownerIdentity: 'pokt1user',
      metadata: { outcome: 'failed', error: 'boom' },
    })
  })

  // CAS returns no row on a retry / already-transitioned attempt — must not
  // re-notify the owner.
  it('does NOT fire when the CAS transition returns no row', async () => {
    const { activities } = makeActivities(undefined, undefined)

    await activities.markAttemptCompleted(7, ['a1'])
    await activities.markAttemptFailed(7, 'boom')

    expect(mockDispatch).not.toHaveBeenCalled()
  })
})
