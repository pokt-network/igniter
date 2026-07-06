import type { NotificationMessage, DiscordEmbed } from './types'

// Shared "chrome" for rich notification messages: assembles the Discord embed,
// Telegram HTML, and dark-theme email HTML around app-supplied CONTENT. Both
// provider and middleman build their event-specific content (title, colors,
// emoji, body) and hand it here so the three channel formats look identical
// across apps. Mirrors the provider's original richMessageBuilder layout.
export interface RichMessageParts {
  // Event display
  title: string
  plainBody: string
  emailColor: string // hex, e.g. '#48e5c2'
  discordColor?: number
  emoji: string // telegram header glyph
  // App-built body content per channel
  discordDescription: string // markdown
  telegramBodyLines: string[]
  emailBodyRowsHtml: string
  // Footer / linking
  senderLabel: string
  url?: string
  uuid?: string | null
  now: Date
}

function buildTelegramHtml(p: RichMessageParts): string {
  const date = p.now.toUTCString().replace(' GMT', ' UTC')
  const lines: string[] = [`${p.emoji} <b>${p.title}</b>`, '', ...p.telegramBodyLines]
  lines.push('')
  lines.push(`🕐 <i>${date}</i>`)
  lines.push(`📡 <i>${p.senderLabel}</i>`)
  if (p.url) {
    lines.push(`🔗 <a href="${p.url}">View in Dashboard</a>`)
  }
  if (p.uuid && !p.url) {
    lines.push('')
    lines.push(`🔖 <code>${p.uuid}</code> <i>(tap to copy)</i>`)
    lines.push('')
    lines.push(`<i>Search for this ID in the Notifications page to view details.</i>`)
  }
  return lines.join('\n')
}

function buildEmailHtml(p: RichMessageParts): string {
  const color = p.emailColor
  const title = p.title
  const typeLabel = title.toUpperCase()
  const date = p.now.toUTCString().replace(' GMT', ' UTC')

  const linkHtml = p.url
    ? `<table border="0" cellpadding="0" cellspacing="0" style="margin:16px 0 0">
        <tr><td style="background-color:${color};border-radius:6px">
          <a href="${p.url}" style="display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;color:#0a0b0f;text-decoration:none;letter-spacing:0.02em">View in Dashboard →</a>
        </td></tr>
      </table>`
    : ''

  const noUrlNote = p.uuid && !p.url
    ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5">Search for this ID in the <b style="color:#94a3b8">Notifications</b> page to view details.</p>`
    : ''

  const uuidHtml = p.uuid && !p.url
    ? `<p style="margin:16px 0 4px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.06em">Notification ID &mdash; click to select</p>
       <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#94a3b8;background-color:#0a0b10;border:1px solid #2a3045;border-radius:4px;padding:8px 12px;word-break:break-all;cursor:text;user-select:all;-webkit-user-select:all">${p.uuid}</p>
       ${noUrlNote}`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#070809;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#070809">
<tr><td align="center" style="padding:32px 16px">
  <table width="100%" style="max-width:560px" border="0" cellpadding="0" cellspacing="0">
    <tr><td style="background-color:#0f1117;border-radius:8px;border:1px solid #1e2332;overflow:hidden;mso-border-alt:none">
      <table width="100%" border="0" cellpadding="0" cellspacing="0">

        <!-- Color bar -->
        <tr><td style="height:4px;background-color:${color};line-height:4px;font-size:4px">&nbsp;</td></tr>

        <!-- Header -->
        <tr><td style="padding:24px 28px 20px">
          <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${color}">${typeLabel}</p>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3">${title}</h1>
        </td></tr>

        <!-- Divider -->
        <tr><td style="height:1px;background-color:#1e2332;line-height:1px;font-size:1px">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="padding:20px 28px">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            ${p.emailBodyRowsHtml}
          </table>
        </td></tr>

        <!-- Divider -->
        <tr><td style="height:1px;background-color:#1e2332;line-height:1px;font-size:1px">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 28px;background-color:#090a0d">
          ${uuidHtml}
          ${linkHtml}
          <p style="margin:20px 0 0;font-size:11px;color:#334155">Sent by ${p.senderLabel} &bull; ${date}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

export function composeRichMessage(p: RichMessageParts): NotificationMessage {
  const discordLinkLine = p.url ? `\n[🔗 View in Dashboard](${p.url})` : ''
  const discordNoUrlNote = p.uuid && !p.url
    ? '\n*Search for this ID in the Notifications page to view details.*'
    : ''
  const discordUuidBlock = p.uuid && !p.url ? `\n\`\`\`\n${p.uuid}\n\`\`\`` : ''

  const discordEmbed: DiscordEmbed = {
    title: p.title,
    description: p.discordDescription + discordLinkLine + discordNoUrlNote + discordUuidBlock,
    color: p.discordColor,
    timestamp: p.now.toISOString(),
    footer: { text: p.senderLabel },
  }

  return {
    title: p.title,
    body:
      p.plainBody +
      (p.url
        ? `\n\nView details: ${p.url}`
        : p.uuid
          ? `\n\nNotification ID: ${p.uuid}\nSearch for this ID in the Notifications page to view details.`
          : ''),
    discord: { embeds: [discordEmbed] },
    telegram: { html: buildTelegramHtml(p) },
    email: {
      subject: `[${p.senderLabel}] ${p.title}`,
      html: buildEmailHtml(p),
    },
  }
}
