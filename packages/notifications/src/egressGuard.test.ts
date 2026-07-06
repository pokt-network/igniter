import { assertSafeHost, assertSafeUrl, parseEgressAllowlist } from '@igniter/notifications'
import { lookup } from 'node:dns/promises'

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }))
const mockLookup = lookup as jest.MockedFunction<typeof lookup>

function resolvesTo(...ips: string[]) {
  mockLookup.mockResolvedValue(ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never)
}

beforeEach(() => jest.clearAllMocks())

describe('assertSafeHost', () => {
  it('allows a public address', async () => {
    resolvesTo('1.1.1.1')
    await expect(assertSafeHost('example.com')).resolves.toBeUndefined()
  })

  it.each([
    ['10.0.0.5', '10.0.0.0/8'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['172.16.0.1', '172.16/12'],
    ['172.31.255.255', '172.31'],
    ['192.168.1.1', '192.168/16'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this-network'],
  ])('blocks %s (%s)', async (ip) => {
    resolvesTo(ip)
    await expect(assertSafeHost('evil.example')).rejects.toThrow(/not allowed/i)
  })

  it('allows a public 172 address just outside the private block', async () => {
    resolvesTo('172.32.0.1')
    await expect(assertSafeHost('ok.example')).resolves.toBeUndefined()
  })

  it('blocks IPv6 loopback and link-local and ULA', async () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::3']) {
      resolvesTo(ip)
      await expect(assertSafeHost('evil.example')).rejects.toThrow(/not allowed/i)
    }
  })

  it('blocks IPv4-mapped IPv6 pointing at a private v4', async () => {
    resolvesTo('::ffff:10.0.0.1')
    await expect(assertSafeHost('evil.example')).rejects.toThrow(/not allowed/i)
  })

  it('blocks hex-encoded IPv4-mapped IPv6 (decimal-only check was bypassable)', async () => {
    for (const ip of [
      '::ffff:a9fe:a9fe', // 169.254.169.254 cloud metadata
      '::ffff:7f00:1', // 127.0.0.1 loopback
      '::ffff:0a00:1', // 10.0.0.1 private
    ]) {
      resolvesTo(ip)
      await expect(assertSafeHost('evil.example')).rejects.toThrow(/not allowed/i)
    }
  })

  it('blocks IPv6 multicast, deprecated-compatible, and NAT64 embedded targets', async () => {
    for (const ip of [
      'ff02::1', // multicast
      '::7f00:1', // ::/96 IPv4-compatible → 127.0.0.1
      '64:ff9b::a9fe:a9fe', // 64:ff9b::/96 NAT64 → 169.254.169.254
    ]) {
      resolvesTo(ip)
      await expect(assertSafeHost('evil.example')).rejects.toThrow(/not allowed/i)
    }
  })

  it('still allows public IPv6 and public IPv4-mapped', async () => {
    for (const ip of ['2606:4700:4700::1111', '::ffff:1.1.1.1']) {
      resolvesTo(ip)
      await expect(assertSafeHost('ok.example')).resolves.toBeUndefined()
    }
  })

  it('blocks when ANY resolved address is private (DNS with mixed answers)', async () => {
    resolvesTo('1.1.1.1', '10.0.0.5')
    await expect(assertSafeHost('rebind.example')).rejects.toThrow(/not allowed/i)
  })

  it('throws a resolve error when the host does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertSafeHost('nope.invalid')).rejects.toThrow(/could not be resolved/i)
  })
})

describe('assertSafeUrl', () => {
  it('allows an https url to a public host', async () => {
    resolvesTo('1.1.1.1')
    await expect(assertSafeUrl('https://discord.com/api/webhooks/1/x')).resolves.toBeUndefined()
  })

  it('rejects a non-http(s) protocol without resolving', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(/protocol/i)
    await expect(assertSafeUrl('gopher://x/')).rejects.toThrow(/protocol/i)
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('rejects a malformed url', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toThrow(/invalid/i)
  })

  it('blocks an http url whose host resolves private', async () => {
    resolvesTo('169.254.169.254')
    await expect(assertSafeUrl('http://metadata.evil/latest')).rejects.toThrow(/not allowed/i)
  })

  it('handles a bracketed IPv6 literal host', async () => {
    resolvesTo('::1')
    await expect(assertSafeUrl('http://[::1]:8080/')).rejects.toThrow(/not allowed/i)
  })
})

describe('operator egress allowlist', () => {
  it('permits a private v4 inside an allowlisted CIDR', async () => {
    const allow = parseEgressAllowlist('10.0.0.0/8')
    resolvesTo('10.0.5.25')
    await expect(assertSafeHost('smtp.internal', allow)).resolves.toBeUndefined()
  })

  it('permits a private v4 that exactly matches a bare allowlisted IP', async () => {
    const allow = parseEgressAllowlist('192.168.1.5')
    resolvesTo('192.168.1.5')
    await expect(assertSafeHost('relay', allow)).resolves.toBeUndefined()
  })

  it('still blocks a private v4 outside the allowlisted range', async () => {
    const allow = parseEgressAllowlist('10.0.0.0/8, 192.168.1.5')
    resolvesTo('192.168.1.6')
    await expect(assertSafeHost('evil.example', allow)).rejects.toThrow(/not allowed/i)
  })

  it('allows an allowlisted host literal without resolving it', async () => {
    const allow = parseEgressAllowlist('mailpit, localhost')
    await expect(assertSafeHost('mailpit', allow)).resolves.toBeUndefined()
    expect(mockLookup).not.toHaveBeenCalled()
  })

  it('matches host literals case-insensitively', async () => {
    const allow = parseEgressAllowlist('Mailpit')
    await expect(assertSafeHost('MAILPIT', allow)).resolves.toBeUndefined()
  })

  it('does not let an allowlisted host literal cover a different host', async () => {
    const allow = parseEgressAllowlist('mailpit')
    resolvesTo('10.0.0.5')
    await expect(assertSafeHost('other.internal', allow)).rejects.toThrow(/not allowed/i)
  })

  it('permits an allowlisted localnet webhook via assertSafeUrl', async () => {
    const allow = parseEgressAllowlist('10.0.0.0/8')
    resolvesTo('10.1.2.3')
    await expect(assertSafeUrl('http://webhook-sink.localnet/hook', allow)).resolves.toBeUndefined()
  })

  it('does not weaken the guard when the allowlist is empty (default behaviour)', async () => {
    const allow = parseEgressAllowlist(undefined)
    resolvesTo('169.254.169.254')
    await expect(assertSafeHost('metadata.evil', allow)).rejects.toThrow(/not allowed/i)
  })

  it('permits an allowlisted IPv6 ULA range', async () => {
    const allow = parseEgressAllowlist('fd00::/8')
    resolvesTo('fd12::3')
    await expect(assertSafeHost('v6.internal', allow)).resolves.toBeUndefined()
  })

  it('ignores an unparseable allowlist token rather than allowing everything', async () => {
    const allow = parseEgressAllowlist('not a cidr/999')
    resolvesTo('10.0.0.5')
    await expect(assertSafeHost('evil.example', allow)).rejects.toThrow(/not allowed/i)
  })

  it('does not fail open on an empty CIDR prefix (10.0.0.0/ → skipped, not allow-all)', async () => {
    const allow = parseEgressAllowlist('10.0.0.0/')
    for (const ip of ['169.254.169.254', '127.0.0.1', '10.0.0.5']) {
      resolvesTo(ip)
      await expect(assertSafeHost('evil.example', allow)).rejects.toThrow(/not allowed/i)
    }
  })

  it('does not fail open when a space typo splits a CIDR ("10.0.0.0/ 8")', async () => {
    const allow = parseEgressAllowlist('10.0.0.0/ 8')
    resolvesTo('169.254.169.254')
    await expect(assertSafeHost('evil.example', allow)).rejects.toThrow(/not allowed/i)
  })

  it('does not fail open on an empty IPv6 prefix (fd00::/ → skipped)', async () => {
    const allow = parseEgressAllowlist('fd00::/')
    resolvesTo('::1')
    await expect(assertSafeHost('evil.example', allow)).rejects.toThrow(/not allowed/i)
  })
})
