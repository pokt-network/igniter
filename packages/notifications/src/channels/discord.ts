import { getLogger } from '@igniter/logger'
import type { DiscordConfig, NotificationChannel, NotificationMessage } from '../types'
import { assertSafeUrl } from '../egressGuard'
import { ChannelDeliveryError, categorizeHttpStatus } from '../channelError'

const logger = getLogger()

export class DiscordChannel implements NotificationChannel {
  name = 'discord'
  private webhookUrl: string

  constructor(config: DiscordConfig) {
    this.webhookUrl = config.webhookUrl
  }

  async send(message: NotificationMessage): Promise<void> {
    // SSRF guard: refuse internal/private destinations before connecting.
    await assertSafeUrl(this.webhookUrl)

    const payload = message.discord
      ? { embeds: message.discord.embeds }
      : { embeds: [{ title: message.title, description: message.body }] }

    let response: Response
    try {
      response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      // Don't reflect the transport error (host/port/connect detail) to callers.
      logger.error('Discord webhook request failed', { err })
      throw new ChannelDeliveryError('discord', 'transient')
    }

    if (!response.ok) {
      const text = await response.text()
      // Log status+body server-side; surface only the status CLASS (not the
      // body) so a caller can distinguish a bad/revoked webhook from a transient
      // failure without the response becoming a read oracle for probed endpoints.
      logger.error('Discord webhook failed', { status: response.status, body: text })
      throw new ChannelDeliveryError('discord', categorizeHttpStatus(response.status), {
        statusCode: response.status,
      })
    }
  }
}
