'use server'

import { z } from 'zod'
import {
  listChannels,
  getChannel,
  insertChannel,
  updateChannel,
  deleteChannel,
  getSmtpConfig,
  listNotificationEvents,
  getNotificationEvent,
  listUnviewedNotificationEvents,
  markNotificationEventsViewed,
  markAllNotificationEventsViewed,
} from '@/lib/dal/notificationChannels'
import { withRequireOwner } from '@/lib/utils/actionUtils'
import { NotificationChannelType } from '@igniter/db/provider/enums'
import {
  DiscordChannel,
  TelegramChannel,
  EmailChannel,
  DiscordConfigSchema,
  TelegramConfigSchema,
  EmailRecipientsSchema,
} from '@igniter/notifications'
import type {
  DiscordChannelConfig,
  TelegramChannelConfig,
  EmailChannelConfig,
  NotificationChannel,
  NotificationChannelConfig,
  NotificationFlags,
} from '@igniter/db/provider/schema'

const BaseChannelSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.nativeEnum(NotificationChannelType),
  enabled: z.boolean().default(true),
})

function validateConfig(type: NotificationChannelType, config: unknown) {
  if (type === NotificationChannelType.Discord) {
    return DiscordConfigSchema.parse(config)
  }
  if (type === NotificationChannelType.Telegram) {
    return TelegramConfigSchema.parse(config)
  }
  if (type === NotificationChannelType.Email) {
    return EmailRecipientsSchema.parse(config)
  }
  throw new Error(`Unknown channel type: ${type}`)
}

// Secret fields (Discord webhook URL, Telegram bot token) are write-only: the
// edit form never receives the stored value, only a blank field. Recipients
// (email to/cc/bcc) and the Telegram chat ID are not credentials and are kept.
function blankChannelSecrets(channel: NotificationChannel): NotificationChannel {
  if (channel.type === NotificationChannelType.Discord) {
    return { ...channel, config: { ...(channel.config as DiscordChannelConfig), webhookUrl: '' } }
  }
  if (channel.type === NotificationChannelType.Telegram) {
    return { ...channel, config: { ...(channel.config as TelegramChannelConfig), botToken: '' } }
  }
  return channel
}

// A blank secret on update/test means "keep the stored value". Merge it back
// from the existing channel before validation so the write-only field doesn't
// wipe the stored credential.
function mergeChannelSecrets(
  type: NotificationChannelType,
  incoming: unknown,
  existing: NotificationChannelConfig,
): unknown {
  if (type === NotificationChannelType.Discord) {
    const inc = incoming as Partial<DiscordChannelConfig>
    if (!inc.webhookUrl) {
      return { ...inc, webhookUrl: (existing as DiscordChannelConfig).webhookUrl }
    }
  }
  if (type === NotificationChannelType.Telegram) {
    const inc = incoming as Partial<TelegramChannelConfig>
    if (!inc.botToken) {
      return { ...inc, botToken: (existing as TelegramChannelConfig).botToken }
    }
  }
  return incoming
}

export async function ListNotificationChannels() {
  return withRequireOwner(async () => listChannels())
}

// Returns the channel config for prefilling the edit form. Secret fields
// (webhook URL, bot token) are blanked — they are write-only and never leave
// the server. Non-secret fields (recipients, Telegram chat ID) are returned.
// The list view never receives configs at all.
export async function GetNotificationChannel(id: number) {
  return withRequireOwner(async () => {
    const channel = await getChannel(id)
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
  return withRequireOwner(async (user) => {
    const base = BaseChannelSchema.parse(data)
    const config = validateConfig(base.type, data.config)

    return insertChannel({
      ...base,
      config,
      ...(data.notificationFlags !== undefined && { notificationFlags: data.notificationFlags }),
      createdBy: user.identity,
      updatedBy: user.identity,
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
  return withRequireOwner(async (user) => {
    const existing = await getChannel(id)
    if (!existing) throw new Error('Notification channel not found')

    const type = data.type ?? existing.type
    const config =
      data.config !== undefined
        ? validateConfig(type, mergeChannelSecrets(type, data.config, existing.config))
        : undefined

    return updateChannel(id, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(config !== undefined && { config }),
      ...(data.notificationFlags !== undefined && { notificationFlags: data.notificationFlags }),
      updatedBy: user.identity,
    })
  })
}

export async function DeleteNotificationChannel(id: number) {
  return withRequireOwner(async () => deleteChannel(id))
}

export async function TestNotificationChannelConfig(data: {
  type: NotificationChannelType
  config: unknown
  // When editing, the form sends a blank secret to mean "keep current". Pass
  // the channel id so the stored secret is merged in before the test runs.
  channelId?: number
}) {
  return withRequireOwner(async () => {
    let rawConfig = data.config
    if (data.channelId !== undefined) {
      const existing = await getChannel(data.channelId)
      if (existing) rawConfig = mergeChannelSecrets(data.type, rawConfig, existing.config)
    }
    const config = validateConfig(data.type, rawConfig)

    const testMessage = {
      title: 'Test notification',
      body: 'This is a test message from your provider. If you received this, your notification channel is configured correctly.',
    }

    if (data.type === NotificationChannelType.Discord) {
      const discord = new DiscordChannel({ webhookUrl: (config as DiscordChannelConfig).webhookUrl })
      await discord.send(testMessage)
      return
    }

    if (data.type === NotificationChannelType.Telegram) {
      const telegram = new TelegramChannel({
        botToken: (config as TelegramChannelConfig).botToken,
        chatId: (config as TelegramChannelConfig).chatId,
      })
      await telegram.send(testMessage)
      return
    }

    if (data.type === NotificationChannelType.Email) {
      const smtpConfig = await getSmtpConfig()
      if (!smtpConfig) throw new Error('SMTP is not configured. Please set up SMTP before testing an email channel.')

      const emailConfig = config as EmailChannelConfig
      const email = new EmailChannel({
        to: emailConfig.to,
        cc: emailConfig.cc,
        bcc: emailConfig.bcc,
        smtp: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          password: smtpConfig.password,
          fromAddress: smtpConfig.fromAddress,
          fromName: smtpConfig.fromName ?? undefined,
        },
      })
      await email.send(testMessage)
    }
  })
}

export async function TestNotificationChannel(id: number) {
  return withRequireOwner(async () => {
    const channel = await getChannel(id)
    if (!channel) throw new Error('Notification channel not found')

    const testMessage = {
      title: 'Test notification',
      body: 'This is a test message from your provider. If you received this, your notification channel is configured correctly.',
    }

    if (channel.type === NotificationChannelType.Discord) {
      const config = channel.config as DiscordChannelConfig
      const discord = new DiscordChannel({ webhookUrl: config.webhookUrl })
      await discord.send(testMessage)
      return
    }

    if (channel.type === NotificationChannelType.Telegram) {
      const config = channel.config as TelegramChannelConfig
      const telegram = new TelegramChannel({ botToken: config.botToken, chatId: config.chatId })
      await telegram.send(testMessage)
      return
    }

    if (channel.type === NotificationChannelType.Email) {
      const smtpConfig = await getSmtpConfig()
      if (!smtpConfig) throw new Error('SMTP is not configured. Please set up SMTP before testing an email channel.')

      const config = channel.config as EmailChannelConfig
      const email = new EmailChannel({
        to: config.to,
        cc: config.cc,
        bcc: config.bcc,
        smtp: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          password: smtpConfig.password,
          fromAddress: smtpConfig.fromAddress,
          fromName: smtpConfig.fromName ?? undefined,
        },
      })
      await email.send(testMessage)
    }
  })
}

export async function ListNotificationEvents(page = 0, pageSize = 25, search?: string) {
  return withRequireOwner(async () => listNotificationEvents(page, pageSize, search))
}

export async function GetNotificationEvent(uuid: string) {
  return withRequireOwner(async () => getNotificationEvent(uuid))
}

export async function ListUnviewedNotificationEvents() {
  return withRequireOwner(async () => listUnviewedNotificationEvents())
}

export async function MarkNotificationEventsViewed(ids: number[]) {
  return withRequireOwner(async () => markNotificationEventsViewed(ids))
}

export async function MarkAllNotificationEventsViewed() {
  return withRequireOwner(async () => markAllNotificationEventsViewed())
}
