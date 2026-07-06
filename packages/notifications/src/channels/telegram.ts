import { getLogger } from '@igniter/logger'
import type { NotificationChannel, NotificationMessage, TelegramConfig } from '../types'
import { assertSafeUrl } from '../egressGuard'

const logger = getLogger()

// Telegram rejects sendMessage with HTTP 400 when `text` exceeds 4096 chars.
// Large event payloads can push the rich HTML past this, so we clamp before
// sending. Truncation happens at a newline boundary because the builder never
// puts newlines inside HTML tags — slicing mid-tag would break parse_mode=HTML
// and trigger the same 400 we are trying to avoid.
const TELEGRAM_MAX_TEXT_LENGTH = 4096

function clampTelegramText(text: string): string {
  if (text.length <= TELEGRAM_MAX_TEXT_LENGTH) return text
  const head = text.slice(0, TELEGRAM_MAX_TEXT_LENGTH - 1)
  const lastNewline = head.lastIndexOf('\n')
  return `${lastNewline > 0 ? head.slice(0, lastNewline) : head}…`
}

export class TelegramChannel implements NotificationChannel {
  name = 'telegram'
  private botToken: string
  private chatId: string

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken
    this.chatId = config.chatId
  }

  async send(message: NotificationMessage): Promise<void> {
    const text = clampTelegramText(
      message.telegram?.html ?? `<b>${message.title}</b>\n\n${message.body}`,
    )

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`
    // Host is the fixed Telegram API; guard anyway for defense-in-depth/uniformity.
    await assertSafeUrl(url)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      logger.error({ err }, 'Telegram request failed')
      throw new Error('Telegram message delivery failed')
    }

    if (!response.ok) {
      const body = await response.text()
      logger.error({ status: response.status, body }, 'Telegram message failed')
      throw new Error('Telegram message delivery failed')
    }
  }
}
