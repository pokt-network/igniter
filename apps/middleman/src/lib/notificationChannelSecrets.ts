import { NotificationChannelType } from '@igniter/db/middleman/enums'
import type {
  NotificationChannel,
  NotificationChannelConfig,
  DiscordChannelConfig,
  TelegramChannelConfig,
  EmailChannelConfig,
} from '@igniter/db/middleman/schema'

// Pure helpers for the write-only-secret contract, extracted from the server
// actions so they can be unit-tested (the actions module imports 'server-only').

// Secret fields are write-only: the edit form never receives the stored value,
// only a blank field. Discord webhook URL, Telegram bot token, and the email
// SMTP password are credentials; recipients and Telegram chat ID are not.
export function blankChannelSecrets(channel: NotificationChannel): NotificationChannel {
  if (channel.type === NotificationChannelType.Discord) {
    return { ...channel, config: { ...(channel.config as DiscordChannelConfig), webhookUrl: '' } }
  }
  if (channel.type === NotificationChannelType.Telegram) {
    return { ...channel, config: { ...(channel.config as TelegramChannelConfig), botToken: '' } }
  }
  if (channel.type === NotificationChannelType.Email) {
    const cfg = channel.config as EmailChannelConfig
    return { ...channel, config: { ...cfg, smtp: { ...cfg.smtp, password: '' } } }
  }
  return channel
}

// A blank secret on update/test means "keep the stored value" — merge it back
// from the existing channel before validation.
export function mergeChannelSecrets(
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
  if (type === NotificationChannelType.Email) {
    const inc = incoming as EmailChannelConfig
    const ex = existing as EmailChannelConfig
    // Only merge a stored password when one actually exists — `existing` may be a
    // non-email channel (mismatched type + channelId), so guard `ex.smtp`. With
    // nothing to merge, fall through and let validation flag the missing password.
    if (inc.smtp && !inc.smtp.password && ex.smtp?.password) {
      return { ...inc, smtp: { ...inc.smtp, password: ex.smtp.password } }
    }
  }
  return incoming
}
