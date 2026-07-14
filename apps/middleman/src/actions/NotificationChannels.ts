'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/utils/actions'
import { NotificationChannelType } from '@igniter/db/middleman/enums'
import type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationFlags,
  DiscordChannelConfig,
  TelegramChannelConfig,
  EmailChannelConfig,
} from '@igniter/db/middleman/schema'
import {
  DiscordChannel,
  TelegramChannel,
  EmailChannel,
  DiscordConfigSchema,
  TelegramConfigSchema,
  EmailConfigSchema,
} from '@igniter/notifications'
import * as dal from '@/lib/dal/notificationChannels'
import { blankChannelSecrets, mergeChannelSecrets } from '@/lib/notificationChannelSecrets'

// Middleman actions return raw/throw by convention, but the shared @igniter/ui
// ChannelList consumes a {success,data|error} result — so notification actions
// wrap their work in this shape.
type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string } }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() }
  } catch (e) {
    return { success: false, error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

const BaseChannelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.nativeEnum(NotificationChannelType),
  enabled: z.boolean().default(true),
})

// Middleman email channels carry their own SMTP (per-user, per D1), so the email
// config is validated with recipients + SMTP — unlike the provider, which keeps
// SMTP in a shared singleton and validates recipients only.
function validateConfig(type: NotificationChannelType, config: unknown): NotificationChannelConfig {
  if (type === NotificationChannelType.Discord) return DiscordConfigSchema.parse(config)
  if (type === NotificationChannelType.Telegram) return TelegramConfigSchema.parse(config)
  if (type === NotificationChannelType.Email) return EmailConfigSchema.parse(config)
  throw new Error(`Unknown channel type: ${type}`)
}

const TEST_MESSAGE = {
  title: 'Test notification',
  body: 'This is a test message from Stake Igniter. If you received this, your notification channel is configured correctly.',
}

async function sendTestMessage(type: NotificationChannelType, config: NotificationChannelConfig): Promise<void> {
  if (type === NotificationChannelType.Discord) {
    await new DiscordChannel({ webhookUrl: (config as DiscordChannelConfig).webhookUrl }).send(TEST_MESSAGE)
    return
  }
  if (type === NotificationChannelType.Telegram) {
    const c = config as TelegramChannelConfig
    await new TelegramChannel({ botToken: c.botToken, chatId: c.chatId }).send(TEST_MESSAGE)
    return
  }
  if (type === NotificationChannelType.Email) {
    const c = config as EmailChannelConfig
    await new EmailChannel({ to: c.to, cc: c.cc, bcc: c.bcc, smtp: c.smtp }).send(TEST_MESSAGE)
  }
}

export async function ListNotificationChannels() {
  return run(async () => dal.listChannels(await requireAuth()))
}

export async function GetNotificationChannel(id: number) {
  return run(async () => {
    const userIdentity = await requireAuth()
    const channel = await dal.getChannel(id, userIdentity)
    if (!channel) throw new Error('Notification channel not found')
    return blankChannelSecrets(channel)
  })
}

export async function CreateNotificationChannel(data: {
  name: string
  type: NotificationChannelType
  enabled?: boolean
  config: unknown
  notificationFlags?: NotificationFlags
}) {
  return run(async () => {
    const userIdentity = await requireAuth()
    const base = BaseChannelSchema.parse(data)
    const config = validateConfig(base.type, data.config)

    return dal.insertChannel({
      ...base,
      config,
      ...(data.notificationFlags !== undefined && { notificationFlags: data.notificationFlags }),
      createdBy: userIdentity,
      updatedBy: userIdentity,
    })
  })
}

export async function UpdateNotificationChannel(
  id: number,
  data: {
    name?: string
    type?: NotificationChannelType
    enabled?: boolean
    config?: unknown
    notificationFlags?: NotificationFlags
  },
) {
  return run(async () => {
    const userIdentity = await requireAuth()
    const existing = await dal.getChannel(id, userIdentity)
    if (!existing) throw new Error('Notification channel not found')

    const type = data.type ?? existing.type
    const config =
      data.config !== undefined
        ? validateConfig(type, mergeChannelSecrets(type, data.config, existing.config))
        : undefined

    return dal.updateChannel(id, userIdentity, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(config !== undefined && { config }),
      ...(data.notificationFlags !== undefined && { notificationFlags: data.notificationFlags }),
      updatedBy: userIdentity,
    })
  })
}

export async function DeleteNotificationChannel(id: number) {
  return run(async () => {
    const userIdentity = await requireAuth()
    return dal.deleteChannel(id, userIdentity)
  })
}

export async function TestNotificationChannelConfig(data: {
  type: NotificationChannelType
  config: unknown
  // When editing, the form sends a blank secret to mean "keep current". Pass the
  // channel id so the stored secret is merged in before the test runs.
  channelId?: number
}) {
  return run(async () => {
    const userIdentity = await requireAuth()
    let rawConfig = data.config
    if (data.channelId !== undefined) {
      const existing = await dal.getChannel(data.channelId, userIdentity)
      if (existing) rawConfig = mergeChannelSecrets(data.type, rawConfig, existing.config)
    }
    const config = validateConfig(data.type, rawConfig)
    await sendTestMessage(data.type, config)
  })
}

export async function TestNotificationChannel(id: number) {
  return run(async () => {
    const userIdentity = await requireAuth()
    const channel = await dal.getChannel(id, userIdentity)
    if (!channel) throw new Error('Notification channel not found')
    await sendTestMessage(channel.type, channel.config)
  })
}

export async function ListNotificationEvents(
  page = 0,
  pageSize = 25,
  filters?: dal.NotificationEventFilters,
) {
  return run(async () => dal.listNotificationEvents(await requireAuth(), page, pageSize, filters))
}

export async function GetNotificationEvent(uuid: string) {
  return run(async () => {
    const event = await dal.getNotificationEvent(uuid, await requireAuth())
    if (!event) throw new Error('Notification event not found')
    return event
  })
}

export async function ListUnviewedNotificationEvents() {
  return run(async () => dal.listUnviewedNotificationEvents(await requireAuth()))
}

export async function MarkNotificationEventsViewed(ids: number[]) {
  return run(async () => {
    const userIdentity = await requireAuth()
    return dal.markNotificationEventsViewed(ids, userIdentity)
  })
}

export async function MarkAllNotificationEventsViewed() {
  return run(async () => dal.markAllNotificationEventsViewed(await requireAuth()))
}

export async function GetNotificationPreferences() {
  return run(async () => {
    const userIdentity = await requireAuth()
    const prefs = await dal.getPreferences(userIdentity)
    // Absent row = defaults: in-app feed enabled.
    return { inAppFeedEnabled: prefs?.inAppFeedEnabled ?? true }
  })
}

export async function SetInAppFeedEnabled(enabled: boolean) {
  return run(async () => {
    const userIdentity = await requireAuth()
    await dal.setInAppFeedEnabled(userIdentity, enabled)
    return { inAppFeedEnabled: enabled }
  })
}
