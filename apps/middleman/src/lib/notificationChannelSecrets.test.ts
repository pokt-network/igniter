import { NotificationChannelType } from '@igniter/db/middleman/enums'
import type { NotificationChannel } from '@igniter/db/middleman/schema'
import { blankChannelSecrets, mergeChannelSecrets } from './notificationChannelSecrets'

function makeChannel(type: NotificationChannelType, config: unknown): NotificationChannel {
  return { id: 1, type, config } as unknown as NotificationChannel
}

const smtp = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'user',
  password: 'stored-pass',
  fromAddress: 'from@example.com',
}

describe('blankChannelSecrets', () => {
  it('blanks the discord webhook URL', () => {
    const ch = makeChannel(NotificationChannelType.Discord, { webhookUrl: 'https://hook' })
    const blanked = blankChannelSecrets(ch)
    expect((blanked.config as { webhookUrl: string }).webhookUrl).toBe('')
  })

  it('blanks the telegram bot token but keeps the chat id', () => {
    const ch = makeChannel(NotificationChannelType.Telegram, { botToken: '123:abc', chatId: '-100' })
    const blanked = blankChannelSecrets(ch)
    const cfg = blanked.config as { botToken: string; chatId: string }
    expect(cfg.botToken).toBe('')
    expect(cfg.chatId).toBe('-100')
  })

  it('blanks the email smtp password but keeps host/recipients', () => {
    const ch = makeChannel(NotificationChannelType.Email, { to: ['a@b.com'], smtp })
    const blanked = blankChannelSecrets(ch)
    const cfg = blanked.config as { to: string[]; smtp: typeof smtp }
    expect(cfg.smtp.password).toBe('')
    expect(cfg.smtp.host).toBe('smtp.example.com')
    expect(cfg.to).toEqual(['a@b.com'])
  })

  it('does not mutate the original channel object', () => {
    const config = { webhookUrl: 'https://hook' }
    const ch = makeChannel(NotificationChannelType.Discord, config)
    blankChannelSecrets(ch)
    expect(config.webhookUrl).toBe('https://hook')
  })
})

describe('mergeChannelSecrets', () => {
  it('restores the stored discord webhook when the incoming one is blank', () => {
    const merged = mergeChannelSecrets(
      NotificationChannelType.Discord,
      { webhookUrl: '' },
      { webhookUrl: 'https://stored' } as never,
    ) as { webhookUrl: string }
    expect(merged.webhookUrl).toBe('https://stored')
  })

  it('keeps a non-blank incoming discord webhook', () => {
    const merged = mergeChannelSecrets(
      NotificationChannelType.Discord,
      { webhookUrl: 'https://new' },
      { webhookUrl: 'https://stored' } as never,
    ) as { webhookUrl: string }
    expect(merged.webhookUrl).toBe('https://new')
  })

  it('restores the stored telegram bot token when blank', () => {
    const merged = mergeChannelSecrets(
      NotificationChannelType.Telegram,
      { botToken: '', chatId: '-100' },
      { botToken: '123:stored', chatId: '-100' } as never,
    ) as { botToken: string }
    expect(merged.botToken).toBe('123:stored')
  })

  it('restores the stored smtp password when blank', () => {
    const merged = mergeChannelSecrets(
      NotificationChannelType.Email,
      { to: ['a@b.com'], smtp: { ...smtp, password: '' } },
      { to: ['a@b.com'], smtp } as never,
    ) as { smtp: { password: string } }
    expect(merged.smtp.password).toBe('stored-pass')
  })

  it('keeps a non-blank incoming smtp password', () => {
    const merged = mergeChannelSecrets(
      NotificationChannelType.Email,
      { to: ['a@b.com'], smtp: { ...smtp, password: 'new-pass' } },
      { to: ['a@b.com'], smtp } as never,
    ) as { smtp: { password: string } }
    expect(merged.smtp.password).toBe('new-pass')
  })

  it('does not throw when existing is a non-email channel (type/channelId mismatch)', () => {
    // The L2 fix: existing has no `.smtp`; fall through so validation flags it.
    const incoming = { to: ['a@b.com'], smtp: { ...smtp, password: '' } }
    const merged = mergeChannelSecrets(
      NotificationChannelType.Email,
      incoming,
      { webhookUrl: 'https://stored' } as never,
    )
    expect(merged).toBe(incoming)
  })

  it('returns incoming unchanged when incoming has no smtp block', () => {
    const incoming = { to: ['a@b.com'] }
    expect(
      mergeChannelSecrets(NotificationChannelType.Email, incoming, { to: [], smtp } as never),
    ).toBe(incoming)
  })
})
