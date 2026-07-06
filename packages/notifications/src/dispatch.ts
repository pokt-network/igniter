import type { Transporter } from 'nodemailer'
import { DiscordChannel } from './channels/discord'
import { TelegramChannel } from './channels/telegram'
import { EmailChannel } from './channels/email'
import type {
  DiscordConfig,
  TelegramConfig,
  EmailConfig,
  NotificationMessage,
} from './types'

export type DispatchChannelType = 'discord' | 'telegram' | 'email'

// A channel ready to receive a message: its secrets/recipients already decrypted
// and, for email, its SMTP already resolved into the config (singleton for the
// provider, per-channel for middleman). The caller does the app-specific work of
// loading + filtering channels and resolving email SMTP before calling dispatch.
export type DispatchChannel = {
  id: number
  name: string
  type: DispatchChannelType
  config: DiscordConfig | TelegramConfig | EmailConfig
}

export type ChannelDeliveryResult = {
  id: number
  name: string
  type: DispatchChannelType
  status: 'sent' | 'error'
  error?: string
}

// Sends one already-built message to each channel, capturing per-channel
// delivery status. Delivery failures are recorded, never thrown, so one bad
// channel does not stop the rest — the caller persists the returned results.
//
// opts.emailTransporter: when every email channel shares one SMTP server (the
// single-owner provider case), pass a pre-built pooled transport to reuse one
// TCP+TLS+AUTH handshake across the whole run. Omit it for per-channel SMTP
// (middleman), where each EmailChannel builds its own transport from
// config.smtp. The caller owns the transporter lifecycle and must close it.
export async function dispatchToChannels(
  channels: DispatchChannel[],
  message: NotificationMessage,
  opts: { emailTransporter?: Transporter } = {},
): Promise<ChannelDeliveryResult[]> {
  const results: ChannelDeliveryResult[] = []

  for (const channel of channels) {
    try {
      if (channel.type === 'discord') {
        await new DiscordChannel(channel.config as DiscordConfig).send(message)
      } else if (channel.type === 'telegram') {
        await new TelegramChannel(channel.config as TelegramConfig).send(message)
      } else {
        await new EmailChannel(
          channel.config as EmailConfig,
          opts.emailTransporter,
        ).send(message)
      }
      results.push({ id: channel.id, name: channel.name, type: channel.type, status: 'sent' })
    } catch (err) {
      results.push({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}