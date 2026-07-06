import { lookup } from 'node:dns/promises'
import net from 'node:net'

// SSRF egress guard. Notification channels POST to user-supplied destinations
// (Discord webhook URL, SMTP host), and the middleman/provider servers sit in a
// trusted cluster — so before any outbound connection we resolve the host and
// refuse loopback / link-local / private / reserved targets. This blocks an
// authenticated user from steering the server at internal services or the cloud
// metadata endpoint (169.254.169.254).
//
// Note: this is resolve-then-check; a determined attacker could still attempt
// DNS rebinding between this check and the actual connect. Pinning the resolved
// IP into the socket would fully close that gap; for this feature the resolve
// check + the fact that channels only ever talk to well-known public hosts
// (discord.com, api.telegram.org, real mail providers) is the accepted mitigation.

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return true
  const a = parseInt(parts[0]!, 10)
  const b = parseInt(parts[1]!, 10)
  if (Number.isNaN(a) || Number.isNaN(b)) return true
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false
}

// Expand any valid IPv6 literal to its 16 bytes. A trailing dotted-decimal IPv4
// (e.g. ::ffff:1.2.3.4) is folded into two hextets first, so the decimal and the
// hex spelling of the same address (::ffff:1.2.3.4 vs ::ffff:102:304) normalize
// to identical bytes. Returns null on anything unparseable → caller fails closed.
function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0] ?? ip // drop any zone id
  const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const o = [Number(v4[2]), Number(v4[3]), Number(v4[4]), Number(v4[5])]
    if (o.some((n) => n > 255)) return null
    s = v4[1]! + ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const groups =
    tail === null ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function ipv6Blocked(ip: string): boolean {
  const b = ipv6ToBytes(ip)
  if (!b) return true // unparseable → fail closed
  if (b.slice(0, 15).every((x) => x === 0) && (b[15] === 0 || b[15] === 1)) return true // ::/::1 unspecified/loopback
  if (b[0] === 0xff) return true // ff00::/8 multicast
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true // fe80::/10 link-local
  if ((b[0]! & 0xfe) === 0xfc) return true // fc00::/7 unique-local
  // Embedded-IPv4 forms: check the trailing v4 against the IPv4 rules so no
  // encoding can smuggle a private / loopback / metadata target past the guard.
  const embeddedV4 = () => ipv4Blocked(b.slice(12).join('.'))
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return embeddedV4() // ::ffff:0:0/96 mapped
  if (b.slice(0, 12).every((x) => x === 0)) return embeddedV4() // ::/96 compatible (deprecated)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0))
    return embeddedV4() // 64:ff9b::/96 NAT64 well-known prefix
  return false
}

function ipBlocked(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Blocked(ip)
  if (net.isIPv6(ip)) return ipv6Blocked(ip)
  return true // unrecognized format → fail closed
}

// Resolves a hostname and throws if ANY resolved address is a blocked target.
// Errors are safe to surface to the caller (they describe the user's own input,
// not any internal service response).
export async function assertSafeHost(host: string): Promise<void> {
  const cleaned = host.replace(/^\[|\]$/g, '') // strip IPv6 URL brackets
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(cleaned, { all: true })
  } catch {
    throw new Error('Destination host could not be resolved')
  }
  if (addresses.length === 0) throw new Error('Destination host could not be resolved')
  for (const { address } of addresses) {
    if (ipBlocked(address)) {
      throw new Error('Destination address is not allowed')
    }
  }
}

// Validates an outbound URL: http(s) only, and its host must pass assertSafeHost.
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid destination URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Destination protocol is not allowed')
  }
  await assertSafeHost(url.hostname)
}
