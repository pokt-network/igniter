import { buildNotificationMessage } from './messageBuilder'

const opts = { uuid: 'abc-123', senderLabel: 'Stake Igniter' }

describe('buildNotificationMessage', () => {
  it('builds all three channel formats for a tx event', () => {
    const m = buildNotificationMessage('stake', { outcome: 'success', address: 'pokt1xyz', hash: '0xabc' }, opts)
    expect(m.title).toBe('Stake succeeded')
    expect(m.discord?.embeds?.[0]?.title).toBe('Stake succeeded')
    expect(m.telegram?.html).toContain('Stake succeeded')
    expect(m.email?.html).toContain('Stake succeeded')
    expect(m.email?.subject).toBe('[Stake Igniter] Stake succeeded')
  })

  it('colors failures red', () => {
    const m = buildNotificationMessage('unstake', { outcome: 'failure' }, opts)
    expect(m.title).toBe('Unstake failed')
    expect(m.discord?.embeds?.[0]?.color).toBe(0xef4444)
  })

  it('import completed includes the supplier count', () => {
    const m = buildNotificationMessage('import_result', { outcome: 'completed', supplierCount: 3 }, opts)
    expect(m.title).toBe('Supplier import completed')
    expect(m.body).toContain('3 supplier(s)')
  })

  it('import failed includes the error', () => {
    const m = buildNotificationMessage('import_result', { outcome: 'failed', error: 'boom' }, opts)
    expect(m.title).toBe('Supplier import failed')
    expect(m.body).toContain('boom')
  })

  it('service_change uses detail + address', () => {
    const m = buildNotificationMessage('service_change', { detail: 'Service X added.', address: 'pokt1abc' }, opts)
    expect(m.title).toBe('Supplier service changed')
    expect(m.body).toContain('Service X added.')
    expect(m.email?.html).toContain('pokt1abc')
  })

  it('revshare_change has a title and a default body', () => {
    const m = buildNotificationMessage('revshare_change', {}, opts)
    expect(m.title).toBe('Revenue share changed')
    expect(m.body.length).toBeGreaterThan(0)
  })

  it('embeds the uuid when there is no deep link', () => {
    const m = buildNotificationMessage('stake', { outcome: 'success' }, opts)
    expect(m.email?.html).toContain('abc-123')
    expect(m.telegram?.html).toContain('abc-123')
  })

  it('HTML-escapes user-derived content in telegram + email bodies', () => {
    const m = buildNotificationMessage('service_change', { detail: 'svc <b>x</b> & y' }, opts)
    expect(m.telegram?.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(m.telegram?.html).not.toContain('<b>x</b>')
    expect(m.email?.html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(m.email?.html).toContain('&amp; y')
  })

  it('operational_funds completed is orange, failed is red', () => {
    const ok = buildNotificationMessage('operational_funds', { outcome: 'success' }, opts)
    expect(ok.title).toBe('Operational funds completed')
    expect(ok.discord?.embeds?.[0]?.color).toBe(0xf97316)
    const bad = buildNotificationMessage('operational_funds', { outcome: 'failure' }, opts)
    expect(bad.title).toBe('Operational funds failed')
    expect(bad.discord?.embeds?.[0]?.color).toBe(0xef4444)
  })

  it('upstake uses its own label', () => {
    const m = buildNotificationMessage('upstake', { outcome: 'success' }, opts)
    expect(m.title).toBe('Upstake succeeded')
    expect(m.body).toContain('Your upstake transaction succeeded.')
  })

  it('includes the tx hash line when present', () => {
    const m = buildNotificationMessage('stake', { outcome: 'success', hash: '0xdeadbeef' }, opts)
    expect(m.body).toContain('Tx: 0xdeadbeef')
  })

  it('omits the supplier line when no address is given', () => {
    const m = buildNotificationMessage('stake', { outcome: 'success' }, opts)
    expect(m.body).not.toContain('Supplier:')
  })

  it('falls back to a generic notification for unknown types', () => {
    const m = buildNotificationMessage('mystery' as never, {}, opts)
    expect(m.title).toBe('Notification')
  })

  it('keeps the discord description raw markdown while telegram escapes', () => {
    const m = buildNotificationMessage('service_change', { detail: 'svc <b>x</b>' }, opts)
    expect(m.discord?.embeds?.[0]?.description).toContain('<b>x</b>')
    expect(m.telegram?.html).not.toContain('<b>x</b>')
  })

  it('uses the dashboard link instead of the uuid when a url is provided', () => {
    const m = buildNotificationMessage('stake', { outcome: 'success' }, { ...opts, url: 'https://app/n' })
    expect(m.body).toContain('View details: https://app/n')
    expect(m.body).not.toContain('Notification ID')
    expect(m.telegram?.html).toContain('View in Dashboard')
    expect(m.telegram?.html).not.toContain('abc-123')
  })

  it('escapes double quotes in user-derived text', () => {
    const m = buildNotificationMessage('service_change', { detail: 'say "hi"' }, opts)
    expect(m.telegram?.html).toContain('&quot;hi&quot;')
  })
})
