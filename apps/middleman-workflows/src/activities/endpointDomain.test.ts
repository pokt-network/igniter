import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { endpointDomain, hostDomain } from './endpointDomain'

// The cases of pocketdex's own endpointDomain tests (src/mappings/utils/service_config_history.spec.ts), so both
// sides keep one rule, plus the mainnet domains igniter used to miss
describe('endpointDomain', () => {
  it('an IPv4 host is the whole address, with or without a port', () => {
    expect(endpointDomain('http://10.0.3.4')).toBe('10.0.3.4')
    expect(endpointDomain('http://144.202.31.211:8050')).toBe('144.202.31.211')
    expect(endpointDomain('http://999.1.1.1')).toBeNull()
    // stored as is on mainnet (2026-10-15); the old rule here gave '132.184', which matches nothing
    expect(endpointDomain('http://87.99.132.184:8545')).toBe('87.99.132.184')
  })

  it('an IPv6 host is its compressed lowercase form, IPv4-mapped in dotted form', () => {
    expect(endpointDomain('http://[2001:db8::1]:8545')).toBe('2001:db8::1')
    expect(endpointDomain('http://[2001:0DB8:0000:0000:0000:0000:0000:0001]')).toBe('2001:db8::1')
    expect(endpointDomain('http://[::ffff:10.0.3.4]:80')).toBe('::ffff:10.0.3.4')
    expect(endpointDomain('http://2001:db8::1')).toBe('2001:db8::1')
  })

  it('a hostname keeps its last two labels, whatever the scheme, case, port, userinfo, path or trailing dot', () => {
    expect(endpointDomain('https://eth.node.Example.COM.:443/v1?x=1')).toBe('example.com')
    expect(endpointDomain('wss://user:pw@rpc.d.io/ws')).toBe('d.io')
    expect(endpointDomain('ws://relay.e.io:8546')).toBe('e.io')
    expect(endpointDomain(' https://a.b.c/ ')).toBe('b.c')
    expect(endpointDomain('https://localhost')).toBe('localhost')
    expect(endpointDomain('https://eth.nodefleet.net')).toBe('nodefleet.net')
  })

  it('a public suffix is not known, as in pocketdex: x.foo.com.ar is com.ar (stored that way on mainnet)', () => {
    expect(endpointDomain('https://rpc.foo.com.ar')).toBe('com.ar')
  })

  it('never throws: a string that names no host gives no domain', () => {
    for (const value of ['', '   ', 'garbage', 'http://', '://x', null, undefined, 42]) {
      expect(endpointDomain(value)).toBeNull()
    }
  })
})

describe('hostDomain', () => {
  it('reads a bare host as an https URL host', () => {
    expect(hostDomain('rm1.nodefleet.net')).toBe('nodefleet.net')
    expect(hostDomain('87.99.132.184')).toBe('87.99.132.184')
    expect(hostDomain('https://rm1.Nodefleet.net/')).toBe('nodefleet.net')
  })
})

// The same rule as pocketdex's copy (src/mappings/utils/service_config_history.ts endpointDomain + ipv6),
// pinned on both sides by the sha256 of the normalised source: change one, and this fails until the other
// and both pins change together. Normalisation: (1) the text of each function, from `function <name>(` to
// its matching closing brace, endpointDomain then ipv6; (2) lines whose trimmed text starts with `//`
// removed; (3) `"` -> `'`; (4) `;` removed; (5) a TypeScript non-null `!` right before `,` `)` `]` or `.`
// removed; (6) all whitespace removed; (7) the two concatenated; sha256 hex of the UTF-8 bytes.
const DOMAIN_RULE_SHA256 = 'b596552d083a61180943f52566d6e33cf56ead44e5bc067461391042559a6c36'

function functionText(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`no function ${name}`)
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`unbalanced function ${name}`)
}

function normalise(text: string): string {
  return text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/"/g, "'").replace(/;/g, '').replace(/!(?=[,)\].])/g, '').replace(/\s+/g, '')
}

describe('the domain rule pin', () => {
  it('matches the sha256 pinned on both sides', () => {
    const src = readFileSync(join(__dirname, 'endpointDomain.ts'), 'utf8')
    const hash = createHash('sha256').update(normalise(functionText(src, 'endpointDomain')) + normalise(functionText(src, 'ipv6'))).digest('hex')
    expect(hash).toBe(DOMAIN_RULE_SHA256)
  })
})
