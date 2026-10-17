import type { AddressGroupsJson } from '@igniter/db/middleman/schema'
import { extractDomainsForAddressGroup } from './index'

jest.mock('@temporalio/activity', () => {
  const { ApplicationFailure: RealApplicationFailure } = jest.requireActual('@temporalio/common')
  return {
    ApplicationFailure: RealApplicationFailure,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    heartbeat: jest.fn(),
    sleep: jest.fn(),
    Context: { current: () => ({ info: { attempt: 1 } }) },
  }
})

const group = (urls: Array<string>, relayMinerDomain = 'rm1.nodefleet.net', endpointOverrides?: Record<string, string> | null) =>
  ({
    relayMiner: { domain: relayMinerDomain, identity: 'rm-1', region: { urlValue: 'us-east' } },
    addressGroupServices: [{
      serviceId: 'eth',
      service: { endpoints: urls.map((url) => ({ url, rpcType: 3 })) },
      ...(endpointOverrides === undefined ? {} : { endpointOverrides }),
    }],
  }) as unknown as AddressGroupsJson[number]

describe('extractDomainsForAddressGroup', () => {
  it('reads each endpoint URL as the chain gets it, with its template tokens filled in', () => {
    const domains = (url: string) => extractDomainsForAddressGroup(group([url]))
    // igniter's default template, a path after {domain}, a port after it
    expect(domains('https://{region}-{rm}-{sid}-{protocol}.{domain}')).toEqual(['nodefleet.net'])
    expect(domains('https://{region}-{rm}-{sid}-{protocol}.{domain}/v1')).toEqual(['nodefleet.net'])
    expect(domains('https://eth-{sid}.{domain}:8545')).toEqual(['nodefleet.net'])
    // {domain} in the path or the query: the host is another one, and that is the domain the chain stores
    expect(domains('https://gw.example.io/{domain}/rpc')).toEqual(['example.io'])
    expect(domains('https://gw.example.io/rpc?node={domain}')).toEqual(['example.io'])
    // {domain} as a host prefix: the labels after it are the domain
    expect(domains('https://{domain}.cdn.example')).toEqual(['cdn.example'])
    // an empty URL takes the default template for its RPC type
    expect(domains('')).toEqual(['nodefleet.net'])
  })

  it('reads any other URL by pocketdex rule, and lists each domain once', () => {
    expect(extractDomainsForAddressGroup(group(['https://eth.a.io', 'https://base.a.io', 'http://87.99.132.184:8545']))).toEqual(['a.io', '87.99.132.184'])
  })

  it('takes the relay miner domain when a service has no endpoints', () => {
    const ag = { relayMiner: { domain: 'RM1.Nodefleet.net' }, addressGroupServices: [{ serviceId: 'eth', service: { endpoints: [] } }] } as unknown as AddressGroupsJson[number]
    expect(extractDomainsForAddressGroup(ag)).toEqual(['nodefleet.net'])
  })

  it("takes the group's override for the endpoint's RPC type, as the chain does, on whatever domain it is", () => {
    const template = 'https://{region}-{rm}-{sid}-{protocol}.{domain}'
    expect(extractDomainsForAddressGroup(group([template], 'rm1.nodefleet.net', { '3': 'https://eth.other-host.io:8545' }))).toEqual(['other-host.io'])
    // an override for another RPC type leaves this endpoint on its template
    expect(extractDomainsForAddressGroup(group([template], 'rm1.nodefleet.net', { '5': 'https://eth.other-host.io' }))).toEqual(['nodefleet.net'])
  })

  it('reads the template when the payload has no overrides (a provider older than v0.8.0), or empty ones', () => {
    const template = 'https://{region}-{rm}-{sid}-{protocol}.{domain}'
    expect(extractDomainsForAddressGroup(group([template]))).toEqual(['nodefleet.net'])
    expect(extractDomainsForAddressGroup(group([template], 'rm1.nodefleet.net', null))).toEqual(['nodefleet.net'])
    expect(extractDomainsForAddressGroup(group([template], 'rm1.nodefleet.net', {}))).toEqual(['nodefleet.net'])
  })
})
