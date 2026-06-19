import type { NotificationMessage, DiscordEmbed } from '@igniter/notifications'
import type { NotificationEvent, NotificationEventMetadata } from '@/lib/types/notifications'

// ─── Constants ───────────────────────────────────────────────────────────────

const DISCORD_COLORS: Record<string, number> = {
  keys_staked:        0x48e5c2, // mint
  keys_unstaked:      0xf59e0b, // amber
  supplier_funds_low: 0xf97316, // orange
  supplier_stake_low: 0xef4444, // red
  remediation_summary:0x3b82f6, // blue
  delegators_synced:  0x8b5cf6, // purple
}

const EMAIL_COLORS: Record<string, string> = {
  keys_staked:        '#48e5c2',
  keys_unstaked:      '#f59e0b',
  supplier_funds_low: '#f97316',
  supplier_stake_low: '#ef4444',
  remediation_summary:'#3b82f6',
  delegators_synced:  '#8b5cf6',
}

const TELEGRAM_EMOJIS: Record<string, string> = {
  keys_staked:        '🟢',
  keys_unstaked:      '🟡',
  supplier_funds_low: '🟠',
  supplier_stake_low: '🔴',
  remediation_summary:'🔵',
  delegators_synced:  '🟣',
}

export const EVENT_TITLES: Record<string, string> = {
  keys_staked:        'Suppliers Staked',
  keys_unstaked:      'Suppliers Unstaking',
  supplier_funds_low: 'Supplier Funds Low',
  supplier_stake_low: 'Supplier Stake Low',
  remediation_summary:'Remediation Complete',
  delegators_synced:  'Delegators Synced',
}

const REASON_LABELS: Record<string, string> = {
  '1001': 'Service Mismatch',
  '1002': 'Delegator Address Missing',
  '1003': 'Owner Initial Stake',
  '1004': 'Stake Too Low',
  '1005': 'Funds Too Low',
  '1006': 'Address Group Migration',
}

function n(count: number, noun: string) {
  return `${count} ${noun}${count !== 1 ? 's' : ''}`
}

// ─── Discord ─────────────────────────────────────────────────────────────────

function buildDiscordDescription(type: string, meta: NotificationEventMetadata): string {
  if ('addresses' in meta) {
    const count = meta.addresses.length
    const descriptions: Record<string, string> = {
      keys_staked:        `**${n(count, 'supplier')}** transitioned to the Staked state at block **${meta.height}**.`,
      keys_unstaked:      `**${n(count, 'supplier')}** began the unstaking process at block **${meta.height}**.`,
      supplier_funds_low: `**${n(count, 'supplier')}** detected with operational funds below the minimum threshold at block **${meta.height}**.`,
      supplier_stake_low: `**${n(count, 'supplier')}** detected with stake below the minimum threshold at block **${meta.height}**.`,
    }
    return descriptions[type] ?? `${n(count, 'supplier')} affected at block **${meta.height}**.`
  }

  if ('byReason' in meta) {
    const total = Object.values(meta.byReason).reduce(
      (acc, { succeeded, failed }) => ({ s: acc.s + succeeded.length, f: acc.f + failed.length }),
      { s: 0, f: 0 },
    )
    const lines = [`**${total.s} succeeded · ${total.f} failed** at block **${meta.height}**`]
    lines.push('')
    lines.push(...Object.entries(meta.byReason)
      .filter(([, { succeeded, failed }]) => succeeded.length > 0 || failed.length > 0)
      .map(([reason, { succeeded, failed }]) => {
        const label = REASON_LABELS[reason] ?? reason
        const parts: string[] = []
        if (succeeded.length > 0) parts.push(`✓ ${succeeded.length}`)
        if (failed.length > 0) parts.push(`✗ ${failed.length}`)
        return `**${label}:** ${parts.join(' · ')}`
      }))
    return lines.join('\n')
  }

  if ('inserted' in meta) {
    const parts: string[] = []
    if (meta.inserted > 0) parts.push(`**+${meta.inserted}** added`)
    if (meta.updated > 0) parts.push(`**~${meta.updated}** updated`)
    if (meta.disabled > 0) parts.push(`**-${meta.disabled}** disabled`)
    return parts.join(' · ')
  }

  return ''
}

// ─── Telegram ────────────────────────────────────────────────────────────────

function buildTelegramHtml(
  event: NotificationEvent,
  uuid: string | null,
  url: string | undefined,
  now: Date,
  senderLabel: string,
): string {
  const emoji = TELEGRAM_EMOJIS[event.type] ?? '🔔'
  const title = EVENT_TITLES[event.type] ?? event.type
  const meta = event.metadata
  const date = now.toUTCString().replace(' GMT', ' UTC')

  const lines: string[] = [`${emoji} <b>${title}</b>`, '']

  if ('addresses' in meta) {
    const count = meta.addresses.length
    const descriptions: Record<string, string> = {
      keys_staked:        `<b>${n(count, 'supplier')}</b> transitioned to the Staked state.`,
      keys_unstaked:      `<b>${n(count, 'supplier')}</b> began the unstaking process.`,
      supplier_funds_low: `<b>${n(count, 'supplier')}</b> detected with funds below the minimum threshold.`,
      supplier_stake_low: `<b>${n(count, 'supplier')}</b> detected with stake below the minimum threshold.`,
    }
    lines.push(descriptions[event.type] ?? `${n(count, 'supplier')} affected.`)
    lines.push(`Block: <code>${meta.height}</code>`)
  } else if ('byReason' in meta) {
    const total = Object.values(meta.byReason).reduce(
      (acc, { succeeded, failed }) => ({ s: acc.s + succeeded.length, f: acc.f + failed.length }),
      { s: 0, f: 0 },
    )
    lines.push(`<b>${total.s} succeeded · ${total.f} failed</b>`)
    lines.push('')
    for (const [reason, { succeeded, failed }] of Object.entries(meta.byReason)) {
      if (succeeded.length === 0 && failed.length === 0) continue
      const label = REASON_LABELS[reason] ?? reason
      const parts: string[] = []
      if (succeeded.length > 0) parts.push(`✓ ${succeeded.length}`)
      if (failed.length > 0) parts.push(`✗ ${failed.length}`)
      lines.push(`• <b>${label}:</b> ${parts.join(' · ')}`)
    }
    lines.push(`Block: <code>${meta.height}</code>`)
  } else if ('inserted' in meta) {
    if (meta.inserted > 0) lines.push(`• +${meta.inserted} delegator${meta.inserted !== 1 ? 's' : ''} added`)
    if (meta.updated > 0) lines.push(`• ~${meta.updated} delegator${meta.updated !== 1 ? 's' : ''} updated`)
    if (meta.disabled > 0) lines.push(`• -${meta.disabled} delegator${meta.disabled !== 1 ? 's' : ''} disabled`)
  }

  lines.push('')
  lines.push(`🕐 <i>${date}</i>`)
  lines.push(`📡 <i>${senderLabel}</i>`)

  if (url) {
    lines.push(`🔗 <a href="${url}">View in Dashboard</a>`)
  }

  if (uuid && !url) {
    lines.push('')
    lines.push(`🔖 <code>${uuid}</code> <i>(tap to copy)</i>`)
    lines.push('')
    lines.push(`<i>Search for this ID in the Notifications page of your provider dashboard to view details.</i>`)
  }

  return lines.join('\n')
}

// ─── Email ───────────────────────────────────────────────────────────────────

function buildEmailBodyRows(event: NotificationEvent): string {
  const meta = event.metadata

  if ('addresses' in meta) {
    const count = meta.addresses.length
    const descriptions: Record<string, string> = {
      keys_staked:        `<b style="color:#e2e8f0">${n(count, 'supplier')}</b> transitioned to the Staked state at block <b style="color:#e2e8f0">${meta.height}</b>.`,
      keys_unstaked:      `<b style="color:#e2e8f0">${n(count, 'supplier')}</b> began the unstaking process at block <b style="color:#e2e8f0">${meta.height}</b>.`,
      supplier_funds_low: `<b style="color:#e2e8f0">${n(count, 'supplier')}</b> detected with operational funds below the minimum threshold at block <b style="color:#e2e8f0">${meta.height}</b>.`,
      supplier_stake_low: `<b style="color:#e2e8f0">${n(count, 'supplier')}</b> detected with stake below the minimum threshold at block <b style="color:#e2e8f0">${meta.height}</b>.`,
    }
    const desc = descriptions[event.type] ?? `${n(count, 'supplier')} affected at block <b style="color:#e2e8f0">${meta.height}</b>.`
    return `<tr><td style="padding-bottom:8px;font-size:15px;color:#cbd5e1;line-height:1.6">${desc}</td></tr>`
  }

  if ('byReason' in meta) {
    const total = Object.values(meta.byReason).reduce(
      (acc, { succeeded, failed }) => ({ s: acc.s + succeeded.length, f: acc.f + failed.length }),
      { s: 0, f: 0 },
    )
    const reasonRows = Object.entries(meta.byReason)
      .filter(([, { succeeded, failed }]) => succeeded.length > 0 || failed.length > 0)
      .map(([reason, { succeeded, failed }]) => {
        const label = REASON_LABELS[reason] ?? reason
        return `<tr>
          <td style="padding:6px 0;border-bottom:1px solid #1e2332">
            <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;color:#94a3b8">${label}</td>
              <td align="right" style="font-size:13px;white-space:nowrap">
                ${succeeded.length > 0 ? `<span style="color:#48e5c2">✓ ${succeeded.length}</span>` : ''}
                ${succeeded.length > 0 && failed.length > 0 ? `<span style="color:#334155"> &nbsp; </span>` : ''}
                ${failed.length > 0 ? `<span style="color:#ef4444">✗ ${failed.length}</span>` : ''}
              </td>
            </tr></table>
          </td>
        </tr>`
      }).join('')

    const summary = `<b style="color:#e2e8f0">${total.s} succeeded · ${total.f} failed</b> at block <b style="color:#e2e8f0">${meta.height}</b>.`
    return `
      <tr><td style="padding-bottom:12px;font-size:15px;color:#cbd5e1;line-height:1.6">${summary}</td></tr>
      <tr><td>
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr><td style="padding:8px 0 4px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#475569">By Reason</td></tr>
          ${reasonRows}
        </table>
      </td></tr>`
  }

  if ('inserted' in meta) {
    return `
      <tr><td>
        <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px">
          <tr>
            ${statCell('Added',    String(meta.inserted))}
            ${statCell('Updated',  String(meta.updated))}
            ${statCell('Disabled', String(meta.disabled))}
          </tr>
        </table>
      </td></tr>`
  }

  return ''
}

function statCell(label: string, value: string): string {
  return `<td style="background-color:#161a24;border:1px solid #1e2332;border-radius:6px;padding:10px 16px;text-align:center;min-width:60px">
    <p style="margin:0;font-size:18px;font-weight:700;color:#f1f5f9">${value}</p>
    <p style="margin:2px 0 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">${label}</p>
  </td>`
}

function buildEmailHtml(
  event: NotificationEvent,
  uuid: string | null,
  url: string | undefined,
  now: Date,
  senderLabel: string,
): string {
  const color = EMAIL_COLORS[event.type] ?? '#64748b'
  const title = EVENT_TITLES[event.type] ?? event.type
  const typeLabel = title.toUpperCase()
  const date = now.toUTCString().replace(' GMT', ' UTC')

  const bodyRows = buildEmailBodyRows(event)

  const linkHtml = url
    ? `<table border="0" cellpadding="0" cellspacing="0" style="margin:16px 0 0">
        <tr><td style="background-color:${color};border-radius:6px">
          <a href="${url}" style="display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;color:#0a0b0f;text-decoration:none;letter-spacing:0.02em">View in Dashboard →</a>
        </td></tr>
      </table>`
    : ''

  const noUrlNote = uuid && !url
    ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5">Search for this ID in the <b style="color:#94a3b8">Notifications</b> page of your provider dashboard to view details.</p>`
    : ''

  const uuidHtml = uuid && !url
    ? `<p style="margin:16px 0 4px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:0.06em">Notification ID &mdash; click to select</p>
       <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#94a3b8;background-color:#0a0b10;border:1px solid #2a3045;border-radius:4px;padding:8px 12px;word-break:break-all;cursor:text;user-select:all;-webkit-user-select:all">${uuid}</p>
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
            ${bodyRows}
          </table>
        </td></tr>

        <!-- Divider -->
        <tr><td style="height:1px;background-color:#1e2332;line-height:1px;font-size:1px">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 28px;background-color:#090a0d">
          ${uuidHtml}
          ${linkHtml}
          <p style="margin:20px 0 0;font-size:11px;color:#334155">Sent by ${senderLabel} &bull; ${date}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildRichMessage(
  event: NotificationEvent,
  uuid: string | null,
  providerAppUrl: string | undefined,
  providerName: string | null | undefined,
): NotificationMessage {
  const url = uuid && providerAppUrl ? `${providerAppUrl}/admin/notifications?uuid=${uuid}` : undefined
  const now = new Date()
  const title = EVENT_TITLES[event.type] ?? event.type
  const senderLabel = providerName ? `${providerName} · Stake Igniter` : 'Stake Igniter'

  const discordDesc = buildDiscordDescription(event.type, event.metadata)
  const discordLinkLine = url ? `\n[🔗 View in Dashboard](${url})` : ''
  const discordNoUrlNote = uuid && !url
    ? '\n*Search for this ID in the Notifications page of your provider site to view details.*'
    : ''
  const discordUuidBlock = uuid && !url ? `\n\`\`\`\n${uuid}\n\`\`\`` : ''

  const discordEmbed: DiscordEmbed = {
    title,
    description: discordDesc + discordLinkLine + discordNoUrlNote + discordUuidBlock,
    color: DISCORD_COLORS[event.type],
    timestamp: now.toISOString(),
    footer: { text: senderLabel },
  }

  return {
    title,
    body: event.summary.body + (url
      ? `\n\nView details: ${url}`
      : uuid
        ? `\n\nNotification ID: ${uuid}\nSearch for this ID in the Notifications page of your provider dashboard to view details.`
        : ''),
    discord: { embeds: [discordEmbed] },
    telegram: { html: buildTelegramHtml(event, uuid, url, now, senderLabel) },
    email: {
      subject: `[${senderLabel}] ${title}`,
      html: buildEmailHtml(event, uuid, url, now, senderLabel),
    },
  }
}