// Tests the encrypted `config` column of notification_channels via drizzle's
// customType mappers — the same encrypt/decrypt path used at runtime, no DB
// needed. NOTIFICATION_ENCRYPTION_KEY is read at call time, so it can be set per test.
import { notificationChannelsTable } from '@igniter/db/middleman/schema'

const KEY_A = 'ab'.repeat(32) // 64 hex chars = 32 bytes (AES-256)
const KEY_B = 'cd'.repeat(32)

const configColumn = notificationChannelsTable.config

const sampleConfig = {
  webhookUrl: 'https://discord.com/api/webhooks/1/secret-token',
}

function encryptToDriver(value: unknown): string {
  return configColumn.mapToDriverValue(value) as string
}

function decryptFromDriver(raw: string): unknown {
  return configColumn.mapFromDriverValue(raw)
}

describe('notification channel config encryption', () => {
  const originalKey = process.env.NOTIFICATION_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = KEY_A
  })

  afterAll(() => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = originalKey
  })

  it('round-trips a config object through encrypt/decrypt', () => {
    const stored = encryptToDriver(sampleConfig)
    expect(decryptFromDriver(stored)).toEqual(sampleConfig)
  })

  it('stores iv:cipher hex — never the plaintext secret', () => {
    const stored = encryptToDriver(sampleConfig)
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/i)
    expect(stored).not.toContain('secret-token')
    expect(stored).not.toContain('discord.com')
  })

  it('uses a random per-record IV — identical configs encrypt differently', () => {
    const a = encryptToDriver(sampleConfig)
    const b = encryptToDriver(sampleConfig)
    expect(a).not.toBe(b)
    // Both still decrypt to the same object.
    expect(decryptFromDriver(a)).toEqual(decryptFromDriver(b))
  })

  it('fails closed: a hex-shaped value with the wrong key throws, never parses garbage', () => {
    const stored = encryptToDriver(sampleConfig)
    process.env.NOTIFICATION_ENCRYPTION_KEY = KEY_B
    expect(() => decryptFromDriver(stored)).toThrow(/decrypt/i)
  })

  it('passes through legacy plaintext JSON (not iv:cipher shaped)', () => {
    expect(decryptFromDriver('{"webhookUrl":"https://x.example"}')).toEqual({
      webhookUrl: 'https://x.example',
    })
  })

  it('throws on non-hex, non-JSON garbage instead of silently returning it', () => {
    expect(() => decryptFromDriver('not-json-not-hex')).toThrow()
  })
})
