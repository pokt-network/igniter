import { buildRichMessage } from '@/lib/richMessageBuilder'
import type { NotificationEvent } from '@/lib/types/notifications'

const event = {
  type: 'keys_staked',
  metadata: { addresses: ['pokt1a'], height: 10 },
  summary: { title: 'Suppliers Staked', body: 'body' },
} as unknown as NotificationEvent

describe('buildRichMessage HTML escaping', () => {
  it('escapes the provider name (senderLabel) and url in telegram + email HTML', () => {
    const m = buildRichMessage(event, 'u-1', 'https://p.example/"><script>', 'Label <img src=x onerror=1>')
    for (const html of [m.telegram!.html, m.email!.html]) {
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<img')
      expect(html).toContain('Label &lt;img src=x onerror=1&gt; · Stake Igniter')
      expect(html).toContain('href="https://p.example/&quot;&gt;&lt;script&gt;/admin/notifications?uuid=u-1"')
    }
  })

  it('escapes an unknown event type used as the title fallback', () => {
    const m = buildRichMessage({ ...event, type: '<b>x</b>' } as unknown as NotificationEvent, null, undefined, null)
    expect(m.telegram!.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(m.email!.html).toContain('<title>&lt;b&gt;x&lt;/b&gt;</title>')
  })
})
