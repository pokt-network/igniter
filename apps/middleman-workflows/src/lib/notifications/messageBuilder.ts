import type { NotificationMessage } from '@igniter/notifications'
import { composeRichMessage } from '@igniter/notifications'
import type { NotificationEventType } from '@igniter/db/middleman/schema'
import { NOTIFICATION_EVENT_LABELS, NOTIFICATION_EVENT_FALLBACK_DETAIL } from '@igniter/db/middleman/schema'

type Meta = Record<string, unknown>

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

// Escape app/user-derived text before it goes into Telegram parse_mode=HTML and
// the email HTML body — a raw `<` or `&` would break Telegram with a 400 or
// corrupt the email. Discord uses markdown, so its description stays raw.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const GREEN = { hex: '#48e5c2', num: 0x48e5c2, emoji: '🟢' }
const RED = { hex: '#ef4444', num: 0xef4444, emoji: '🔴' }
const BLUE = { hex: '#3b82f6', num: 0x3b82f6, emoji: '🔧' }
const PURPLE = { hex: '#8b5cf6', num: 0x8b5cf6, emoji: '💰' }
const ORANGE = { hex: '#f97316', num: 0xf97316, emoji: '🟠' }

interface Content {
  title: string
  emailColor: string
  discordColor: number
  emoji: string
  lines: string[]
}

function contentFor(type: NotificationEventType, metadata: Meta): Content {
  const address = str(metadata.address)
  const supplierLine = address ? `Supplier: ${address}` : ''
  const outcome = str(metadata.outcome)
  const failed = outcome === 'failure' || outcome === 'failed'
  const txColor = failed ? RED : GREEN

  switch (type) {
    case 'service_change': {
      // A first stake (outcome:'success') is a positive event — render it green
      // with a completion title instead of the neutral "config changed" blue.
      const success = outcome === 'success'
      return {
        title: success ? 'Stake completed' : NOTIFICATION_EVENT_LABELS.service_change,
        emailColor: success ? GREEN.hex : BLUE.hex,
        discordColor: success ? GREEN.num : BLUE.num,
        emoji: success ? GREEN.emoji : BLUE.emoji,
        lines: [str(metadata.detail) || NOTIFICATION_EVENT_FALLBACK_DETAIL.service_change || '', supplierLine].filter(Boolean),
      }
    }
    case 'revshare_change':
      return {
        title: NOTIFICATION_EVENT_LABELS.revshare_change,
        emailColor: PURPLE.hex,
        discordColor: PURPLE.num,
        emoji: PURPLE.emoji,
        lines: [str(metadata.detail) || NOTIFICATION_EVENT_FALLBACK_DETAIL.revshare_change || '', supplierLine].filter(Boolean),
      }
    case 'stake':
    case 'unstake':
    case 'upstake': {
      const label = { stake: 'Stake', unstake: 'Unstake', upstake: 'Upstake' }[type]
      const word = failed ? 'failed' : 'succeeded'
      const hash = str(metadata.hash)
      return {
        title: `${label} ${word}`,
        emailColor: txColor.hex,
        discordColor: txColor.num,
        emoji: txColor.emoji,
        lines: [`Your ${label.toLowerCase()} transaction ${word}.`, supplierLine, hash ? `Tx: ${hash}` : ''].filter(Boolean),
      }
    }
    case 'operational_funds': {
      const word = failed ? 'failed' : 'completed'
      const c = failed ? RED : ORANGE
      return {
        title: `Operational funds ${word}`,
        emailColor: c.hex,
        discordColor: c.num,
        emoji: c.emoji,
        lines: [`An operational funds transaction ${word}.`, supplierLine].filter(Boolean),
      }
    }
    case 'import_result': {
      const f = outcome === 'failed'
      const c = f ? RED : GREEN
      const count = metadata.supplierCount != null ? `${metadata.supplierCount} supplier(s).` : ''
      return {
        title: `Supplier import ${f ? 'failed' : 'completed'}`,
        emailColor: c.hex,
        discordColor: c.num,
        emoji: c.emoji,
        lines: f
          ? [`Your supplier import failed. ${str(metadata.error)}`.trim()]
          : [`Your supplier import completed. ${count}`.trim()],
      }
    }
    default:
      return { title: 'Notification', emailColor: BLUE.hex, discordColor: BLUE.num, emoji: '🔔', lines: [] }
  }
}

// Builds a rich, provider-consistent message (Discord embed + Telegram HTML +
// dark-theme email HTML) for a middleman event, via the shared chrome.
export function buildNotificationMessage(
  type: NotificationEventType,
  metadata: Meta,
  opts: { uuid?: string | null; senderLabel?: string; url?: string },
): NotificationMessage {
  const c = contentFor(type, metadata)
  const escapedLines = c.lines.map(escapeHtml)
  const emailBodyRowsHtml = escapedLines
    .map((l) => `<tr><td style="padding-bottom:8px;font-size:15px;color:#cbd5e1;line-height:1.6">${l}</td></tr>`)
    .join('')

  return composeRichMessage({
    title: c.title,
    plainBody: c.lines.join(' '),
    emailColor: c.emailColor,
    discordColor: c.discordColor,
    emoji: c.emoji,
    discordDescription: c.lines.join('\n'),
    telegramBodyLines: escapedLines,
    emailBodyRowsHtml,
    senderLabel: opts.senderLabel ?? 'Stake Igniter',
    url: opts.url,
    uuid: opts.uuid,
    now: new Date(),
  })
}
