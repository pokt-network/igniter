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

const group = (urls: Array<string>, relayMinerDomain = 'rm1.nodefleet.net') =>
  ({
    relayMiner: { domain: relayMinerDomain, identity: 'rm-1', region: { urlValue: 'us-east' } },
    addressGroupServices: [{ serviceId: 'eth', service: { endpoints: urls.map((url) => ({ url, rpcType: 3 })) } }],
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
})
