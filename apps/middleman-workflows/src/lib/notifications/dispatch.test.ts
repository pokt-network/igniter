import { dispatchUserNotification } from './dispatch'
import { dispatchToChannels } from '@igniter/notifications'
import type DAL from '@/lib/dal/DAL'

// Keep the real module (messageBuilder needs composeRichMessage) but stub the
// network-touching dispatcher.
jest.mock('@igniter/notifications', () => ({
  ...jest.requireActual('@igniter/notifications'),
  dispatchToChannels: jest.fn(),
}))

const mockDispatchToChannels = dispatchToChannels as jest.MockedFunction<typeof dispatchToChannels>

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'my discord',
    type: 'discord',
    config: { webhookUrl: 'https://discord.example/hook' },
    notificationFlags: null,
    ...overrides,
  }
}

function makeDal(channels: unknown[] | Error) {
  const loadEnabledChannelsForOwner = jest.fn()
  if (channels instanceof Error) loadEnabledChannelsForOwner.mockRejectedValue(channels)
  else loadEnabledChannelsForOwner.mockResolvedValue(channels)
  const insertEvent = jest.fn().mockResolvedValue(undefined)
  const dal = { notifications: { loadEnabledChannelsForOwner, insertEvent } }
  return { dal: dal as unknown as DAL, loadEnabledChannelsForOwner, insertEvent }
}

const logger = { info: jest.fn(), error: jest.fn() }

const event = {
  type: 'stake' as const,
  ownerIdentity: 'pokt1owner',
  metadata: { outcome: 'success' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatchToChannels.mockResolvedValue([])
})

describe('dispatchUserNotification', () => {
  it('persists the event even when the owner has no channels', async () => {
    const { dal, insertEvent } = makeDal([])
    await dispatchUserNotification(dal, logger, event)
    expect(mockDispatchToChannels).not.toHaveBeenCalled()
    expect(insertEvent).toHaveBeenCalledTimes(1)
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stake',
        createdBy: 'pokt1owner',
        metadata: { outcome: 'success' },
        channels: [],
      }),
    )
  })

  it('still persists the event when channel loading throws (bad key / DB error)', async () => {
    const { dal, insertEvent } = makeDal(new Error('decrypt failed'))
    await dispatchUserNotification(dal, logger, event)
    expect(insertEvent).toHaveBeenCalledTimes(1)
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(logger.error).toHaveBeenCalled()
  })

  it('skips channels whose flag for the event type is off', async () => {
    const { dal } = makeDal([
      makeChannel({ id: 1, notificationFlags: { stake: false } }),
      makeChannel({ id: 2, name: 'subscribed', notificationFlags: { stake: true } }),
    ])
    await dispatchUserNotification(dal, logger, event)
    expect(mockDispatchToChannels).toHaveBeenCalledTimes(1)
    const [channels] = mockDispatchToChannels.mock.calls[0]!
    expect(channels.map((c) => c.id)).toEqual([2])
  })

  it('treats null notificationFlags as subscribed (defaults all on)', async () => {
    const { dal } = makeDal([makeChannel({ notificationFlags: null })])
    await dispatchUserNotification(dal, logger, event)
    expect(mockDispatchToChannels).toHaveBeenCalledTimes(1)
  })

  it('persists per-channel delivery results', async () => {
    const results = [{ id: 1, name: 'my discord', type: 'discord' as const, status: 'sent' as const }]
    mockDispatchToChannels.mockResolvedValue(results)
    const { dal, insertEvent } = makeDal([makeChannel()])
    await dispatchUserNotification(dal, logger, event)
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({ channels: results }))
  })

  it('never throws, even when persisting fails', async () => {
    const { dal, insertEvent } = makeDal([])
    insertEvent.mockRejectedValue(new Error('db down'))
    await expect(dispatchUserNotification(dal, logger, event)).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })

  it('never throws when external delivery fails', async () => {
    mockDispatchToChannels.mockRejectedValue(new Error('network down'))
    const { dal, insertEvent } = makeDal([makeChannel()])
    await expect(dispatchUserNotification(dal, logger, event)).resolves.toBeUndefined()
    // Delivery failed but the in-app event still lands.
    expect(insertEvent).toHaveBeenCalledTimes(1)
  })

  it('threads the same uuid through the message and the persisted event', async () => {
    const { dal, insertEvent } = makeDal([makeChannel()])
    await dispatchUserNotification(dal, logger, event)
    const [, messageArg] = mockDispatchToChannels.mock.calls[0]!
    const persistedUuid = insertEvent.mock.calls[0]![0].uuid as string
    expect(persistedUuid).toBeTruthy()
    expect(messageArg.email?.html).toContain(persistedUuid)
  })

  it('persists with empty channels when every channel is filtered out', async () => {
    const { dal, insertEvent } = makeDal([makeChannel({ notificationFlags: { stake: false } })])
    await dispatchUserNotification(dal, logger, event)
    expect(mockDispatchToChannels).not.toHaveBeenCalled()
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
  })
})
