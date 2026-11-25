jest.mock('server-only', () => ({}))

// Only the session is mocked; the real requireAuth runs.
const auth = jest.fn()
jest.mock('@/auth', () => ({ auth: () => auth() }))

const getChannel = jest.fn()
const insertChannel = jest.fn()
const updateChannel = jest.fn()
jest.mock('@/lib/dal/notificationChannels', () => ({
  getChannel: (...args: unknown[]) => getChannel(...args),
  insertChannel: (...args: unknown[]) => insertChannel(...args),
  updateChannel: (...args: unknown[]) => updateChannel(...args),
}))

import { CreateNotificationChannel, UpdateNotificationChannel } from './NotificationChannels'
import { NotificationChannelType, UserRole } from '@igniter/db/middleman/enums'

const DISCORD_CONFIG = { webhookUrl: 'https://discord.com/api/webhooks/1/abc' }

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ user: { identity: 'pokt1caller', role: UserRole.User } })
  getChannel.mockResolvedValue({ id: 3, type: NotificationChannelType.Discord, config: DISCORD_CONFIG })
  insertChannel.mockImplementation(async (v) => v)
  updateChannel.mockImplementation(async (_id, _user, v) => v)
})

describe('UpdateNotificationChannel type change', () => {
  it('refuses a type change whose stored config is not valid for the new type', async () => {
    const result = await UpdateNotificationChannel(3, { type: NotificationChannelType.Telegram })
    expect(result.success).toBe(false)
    expect(updateChannel).not.toHaveBeenCalled()
  })

  it('accepts a type change that sends a config valid for the new type', async () => {
    const result = await UpdateNotificationChannel(3, {
      type: NotificationChannelType.Telegram,
      config: { botToken: '123:abc', chatId: '42' },
    })
    expect(result.success).toBe(true)
    expect(updateChannel).toHaveBeenCalledWith(3, 'pokt1caller', expect.objectContaining({ type: NotificationChannelType.Telegram }))
  })

  it('leaves the config alone when the type does not change', async () => {
    const result = await UpdateNotificationChannel(3, { name: 'renamed' })
    expect(result.success).toBe(true)
    expect(updateChannel.mock.calls[0]![2]).not.toHaveProperty('config')
  })
})

describe('notificationFlags', () => {
  it('stores known flags', async () => {
    const result = await UpdateNotificationChannel(3, { notificationFlags: { stake: false, unstake: true } as never })
    expect(result.success).toBe(true)
    expect(updateChannel).toHaveBeenCalledWith(3, 'pokt1caller', expect.objectContaining({ notificationFlags: { stake: false, unstake: true } }))
  })

  it.each([
    ['an unknown key', { stake: true, admin: true }],
    ['a non-boolean value', { stake: 'yes' }],
    ['a non-object', 'all'],
  ])('refuses %s on update', async (_label, flags) => {
    const result = await UpdateNotificationChannel(3, { notificationFlags: flags as never })
    expect(result.success).toBe(false)
    expect(updateChannel).not.toHaveBeenCalled()
  })

  it('refuses invalid flags on create', async () => {
    const result = await CreateNotificationChannel({
      name: 'mine',
      type: NotificationChannelType.Discord,
      config: DISCORD_CONFIG,
      notificationFlags: { stake: true, extra: 1 } as never,
    })
    expect(result.success).toBe(false)
    expect(insertChannel).not.toHaveBeenCalled()
  })
})
