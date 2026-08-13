import { getLogger } from '@igniter/logger'
import type { NotificationChannel, NotificationMessage } from './types'

const logger = getLogger()

export class Notifier {
  private channels: NotificationChannel[] = []

  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel)
  }

  async send(message: NotificationMessage): Promise<void> {
    const results = await Promise.allSettled(
      this.channels.map((channel) => channel.send(message)),
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const channel = this.channels[i]!
      if (result.status === 'rejected') {
        logger.error(
          'Failed to send notification',
          { channel: channel.name, error: result.reason },
        )
      }
    }
  }
}
