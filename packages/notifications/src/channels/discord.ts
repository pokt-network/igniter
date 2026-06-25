import { getLogger } from '@igniter/logger'
import type { DiscordConfig, NotificationChannel, NotificationMessage } from '../types'

const logger = getLogger()

export class DiscordChannel implements NotificationChannel {
  name = 'discord'
  private webhookUrl: string

  constructor(config: DiscordConfig) {
    this.webhookUrl = config.webhookUrl
  }

  async send(message: NotificationMessage): Promise<void> {
    const payload = message.discord
      ? { embeds: message.discord.embeds }
      : { embeds: [{ title: message.title, description: message.body }] }

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const text = await response.text()
      logger.error({ status: response.status, body: text }, 'Discord webhook failed')
      throw new Error(`Discord webhook failed with status ${response.status}: ${text}`)
    }
  }
}
