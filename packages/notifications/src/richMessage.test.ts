import { composeRichMessage } from '@igniter/notifications'
import type { RichMessageParts } from '@igniter/notifications'

const NOW = new Date('2026-01-02T03:04:05Z')

function parts(overrides: Partial<RichMessageParts> = {}): RichMessageParts {
  return {
    title: 'Stake succeeded',
    plainBody: 'Your stake transaction succeeded.',
    emailColor: '#48e5c2',
    discordColor: 0x48e5c2,
    emoji: '🟢',
    discordDescription: 'Your stake transaction succeeded.',
    telegramBodyLines: ['Your stake transaction succeeded.'],
    emailBodyRowsHtml: '<tr><td>Your stake transaction succeeded.</td></tr>',
    senderLabel: 'Stake Igniter',
    now: NOW,
    ...overrides,
  }
}

describe('composeRichMessage', () => {
  it('builds the discord embed with title/description/color/timestamp/footer', () => {
    const m = composeRichMessage(parts())
    const embed = m.discord!.embeds![0]!
    expect(embed.title).toBe('Stake succeeded')
    expect(embed.description).toContain('Your stake transaction succeeded.')
    expect(embed.color).toBe(0x48e5c2)
    expect(embed.timestamp).toBe(NOW.toISOString())
    expect(embed.footer).toEqual({ text: 'Stake Igniter' })
  })

  it('builds telegram HTML with the emoji header, body, date, and sender', () => {
    const m = composeRichMessage(parts())
    const html = m.telegram!.html
    expect(html.startsWith('🟢 <b>Stake succeeded</b>')).toBe(true)
    expect(html).toContain('Your stake transaction succeeded.')
    expect(html).toContain('UTC')
    expect(html).toContain('Stake Igniter')
  })

  it('builds the email with prefixed subject, uppercase type label, color, and footer', () => {
    const m = composeRichMessage(parts())
    expect(m.email!.subject).toBe('[Stake Igniter] Stake succeeded')
    const html = m.email!.html
    expect(html).toContain('STAKE SUCCEEDED')
    expect(html).toContain('#48e5c2')
    expect(html).toContain('<tr><td>Your stake transaction succeeded.</td></tr>')
    expect(html).toContain('Sent by Stake Igniter')
  })

  it('embeds the uuid in all three formats when there is no url', () => {
    const m = composeRichMessage(parts({ uuid: 'uuid-42' }))
    expect(m.discord!.embeds![0]!.description).toContain('uuid-42')
    expect(m.telegram!.html).toContain('<code>uuid-42</code>')
    expect(m.email!.html).toContain('uuid-42')
    expect(m.body).toContain('Notification ID: uuid-42')
  })

  it('prefers the dashboard link and suppresses the uuid block when a url is set', () => {
    const m = composeRichMessage(parts({ uuid: 'uuid-42', url: 'https://app.example/n' }))
    expect(m.discord!.embeds![0]!.description).toContain('https://app.example/n')
    expect(m.discord!.embeds![0]!.description).not.toContain('uuid-42')
    expect(m.telegram!.html).toContain('View in Dashboard')
    expect(m.telegram!.html).not.toContain('uuid-42')
    expect(m.email!.html).toContain('View in Dashboard')
    expect(m.email!.html).not.toContain('uuid-42')
    expect(m.body).toContain('View details: https://app.example/n')
    expect(m.body).not.toContain('Notification ID')
  })

  it('leaves the plain body bare when there is neither url nor uuid', () => {
    const m = composeRichMessage(parts())
    expect(m.body).toBe('Your stake transaction succeeded.')
  })
})
