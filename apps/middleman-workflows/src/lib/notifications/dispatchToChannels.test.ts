// Tests the shared transport dispatcher with stubbed network seams: DNS lookup
// (the SSRF egress guard), global fetch (Discord/Telegram) and nodemailer
// (Email). No real network.
import { dispatchToChannels } from '@igniter/notifications'
import type { DispatchChannel } from '@igniter/notifications'
import nodemailer from 'nodemailer'
import { lookup } from 'node:dns/promises'

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}))

const mockLookup = lookup as jest.MockedFunction<typeof lookup>
const mockCreateTransport = nodemailer.createTransport as jest.Mock

const message = {
  title: 'Test',
  body: 'Body',
  telegram: { html: '<b>Test</b>\nBody' },
  email: { subject: '[X] Test', html: '<html>Body</html>' },
}

const discordChannel: DispatchChannel = {
  id: 1,
  name: 'disc',
  type: 'discord',
  config: { webhookUrl: 'https://discord.com/api/webhooks/1/tok' },
}
const telegramChannel: DispatchChannel = {
  id: 2,
  name: 'tele',
  type: 'telegram',
  config: { botToken: '123:abc', chatId: '-100' },
}
const emailChannel: DispatchChannel = {
  id: 3,
  name: 'mail',
  type: 'email',
  config: {
    to: ['a@b.com'],
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'u',
      password: 'p',
      fromAddress: 'from@example.com',
    },
  },
}

const originalFetch = globalThis.fetch
let mockFetch: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  // Default: every host resolves public so the egress guard passes.
  mockLookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }] as never)
  mockFetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' })
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

function makeTransporter() {
  return { sendMail: jest.fn().mockResolvedValue({ messageId: 'mid' }), close: jest.fn() }
}

describe('dispatchToChannels', () => {
  it('POSTs the discord embed payload to the webhook URL', async () => {
    const results = await dispatchToChannels([discordChannel], message)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://discord.com/api/webhooks/1/tok')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toHaveProperty('embeds')
    expect(results).toEqual([{ id: 1, name: 'disc', type: 'discord', status: 'sent' }])
  })

  it('POSTs telegram sendMessage with chat_id and HTML parse mode', async () => {
    await dispatchToChannels([telegramChannel], message)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage')
    const body = JSON.parse(init.body)
    expect(body.chat_id).toBe('-100')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain('Test')
  })

  it('clamps telegram text to 4096 chars at a newline boundary', async () => {
    const longLine = 'x'.repeat(90)
    const html = Array.from({ length: 60 }, () => longLine).join('\n') // ~5.4k chars
    await dispatchToChannels([telegramChannel], { ...message, telegram: { html } })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text.length).toBeLessThanOrEqual(4096)
    expect(body.text.endsWith('…')).toBe(true)
    expect(body.text.slice(0, -1).split('\n').every((l: string) => l === longLine)).toBe(true)
  })

  it('captures an HTTP failure as a generic per-channel error and continues to later channels', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'internal-body' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' })
    const results = await dispatchToChannels([discordChannel, telegramChannel], message)
    expect(results[0]).toMatchObject({ id: 1, status: 'error' })
    // Generic — must NOT leak the upstream status or body (SSRF read-oracle fix).
    expect(results[0]!.error).toContain('delivery failed')
    expect(results[0]!.error).not.toContain('404')
    expect(results[0]!.error).not.toContain('internal-body')
    expect(results[1]).toMatchObject({ id: 2, status: 'sent' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('captures a network rejection generically without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:6379'))
    const results = await dispatchToChannels([discordChannel], message)
    expect(results[0]).toMatchObject({ status: 'error' })
    expect(results[0]!.error).toContain('delivery failed')
    expect(results[0]!.error).not.toContain('10.0.0.5')
  })

  it('SSRF guard: blocks a webhook resolving to a private address, without fetching', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never)
    const results = await dispatchToChannels([discordChannel], message)
    expect(results[0]).toMatchObject({ status: 'error' })
    expect(results[0]!.error).toMatch(/not allowed/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('uses an injected email transporter without closing it (caller-owned)', async () => {
    const transporter = makeTransporter()
    const results = await dispatchToChannels([emailChannel], message, {
      emailTransporter: transporter as never,
    })
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@b.com'], subject: '[X] Test', html: '<html>Body</html>' }),
    )
    expect(transporter.close).not.toHaveBeenCalled()
    expect(mockCreateTransport).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ status: 'sent' })
  })

  it('builds a per-channel transport from config.smtp and closes it (middleman path)', async () => {
    const transporter = makeTransporter()
    mockCreateTransport.mockReturnValue(transporter)
    await dispatchToChannels([emailChannel], message)
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false }),
    )
    expect(transporter.sendMail).toHaveBeenCalled()
    expect(transporter.close).toHaveBeenCalledTimes(1)
  })

  it('returns per-channel results in channel order for a mixed run', async () => {
    const transporter = makeTransporter()
    mockCreateTransport.mockReturnValue(transporter)
    const results = await dispatchToChannels([discordChannel, telegramChannel, emailChannel], message)
    expect(results.map((r) => r.id)).toEqual([1, 2, 3])
    expect(results.every((r) => r.status === 'sent')).toBe(true)
  })
})
