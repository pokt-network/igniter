import {
  DiscordConfigSchema,
  TelegramConfigSchema,
  EmailConfigSchema,
  EmailRecipientsSchema,
} from '@igniter/notifications'

describe('notification channel validation', () => {
  it('discord requires a valid webhook url', () => {
    expect(DiscordConfigSchema.safeParse({ webhookUrl: 'https://discord.com/api/webhooks/1/abc' }).success).toBe(true)
    expect(DiscordConfigSchema.safeParse({ webhookUrl: 'not-a-url' }).success).toBe(false)
  })

  it('telegram requires a token and chat id', () => {
    expect(TelegramConfigSchema.safeParse({ botToken: '123:abc', chatId: '-100' }).success).toBe(true)
    expect(TelegramConfigSchema.safeParse({ botToken: '', chatId: '-100' }).success).toBe(false)
  })

  it('email recipients require at least one valid address', () => {
    expect(EmailRecipientsSchema.safeParse({ to: ['a@b.com'] }).success).toBe(true)
    expect(EmailRecipientsSchema.safeParse({ to: [] }).success).toBe(false)
    expect(EmailRecipientsSchema.safeParse({ to: ['nope'] }).success).toBe(false)
  })

  it('full email config requires its own SMTP (per-user)', () => {
    const smtp = { host: 'h', port: 587, secure: true, username: 'u', password: 'p', fromAddress: 'f@b.com' }
    expect(EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp }).success).toBe(true)
    expect(EmailConfigSchema.safeParse({ to: ['a@b.com'] }).success).toBe(false)
  })

  it('rejects invalid cc/bcc addresses', () => {
    expect(EmailRecipientsSchema.safeParse({ to: ['a@b.com'], cc: ['nope'] }).success).toBe(false)
    expect(EmailRecipientsSchema.safeParse({ to: ['a@b.com'], bcc: ['nope'] }).success).toBe(false)
    expect(EmailRecipientsSchema.safeParse({ to: ['a@b.com'], cc: ['c@d.com'] }).success).toBe(true)
  })

  it('rejects a non-positive smtp port', () => {
    const smtp = { host: 'h', port: 0, secure: false, username: 'u', password: 'p', fromAddress: 'f@b.com' }
    expect(EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp }).success).toBe(false)
  })

  it('rejects an invalid smtp fromAddress and empty password', () => {
    const base = { host: 'h', port: 587, secure: false, username: 'u', password: 'p', fromAddress: 'f@b.com' }
    expect(
      EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp: { ...base, fromAddress: 'nope' } }).success,
    ).toBe(false)
    expect(
      EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp: { ...base, password: '' } }).success,
    ).toBe(false)
  })

  it('smtp fromName is optional', () => {
    const smtp = { host: 'h', port: 587, secure: false, username: 'u', password: 'p', fromAddress: 'f@b.com' }
    expect(EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp: { ...smtp, fromName: 'Igniter' } }).success).toBe(true)
    expect(EmailConfigSchema.safeParse({ to: ['a@b.com'], smtp }).success).toBe(true)
  })
})
