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
