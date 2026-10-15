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
    relayMiner: { domain: relayMinerDomain },
    addressGroupServices: [{ service: { endpoints: urls.map((url) => ({ url, rpcType: 3 })) } }],
  }) as unknown as AddressGroupsJson[number]

describe('extractDomainsForAddressGroup', () => {
  it('takes the relay miner domain for a {domain} placeholder anywhere in the URL', () => {
    // igniter's default template, one with a path after the placeholder, and one with a port after it
    expect(extractDomainsForAddressGroup(group(['{scheme}://{region}-{rm}-{sid}-{protocol}.{domain}']))).toEqual(['nodefleet.net'])
    expect(extractDomainsForAddressGroup(group(['https://{region}-{rm}-{sid}-{protocol}.{domain}/v1']))).toEqual(['nodefleet.net'])
    expect(extractDomainsForAddressGroup(group(['https://eth-{sid}.{domain}:8545']))).toEqual(['nodefleet.net'])
  })

  it('reads any other URL by pocketdex rule, and lists each domain once', () => {
    expect(extractDomainsForAddressGroup(group(['https://eth.a.io', 'https://base.a.io', 'http://87.99.132.184:8545']))).toEqual(['a.io', '87.99.132.184'])
  })

  it('takes the relay miner domain when a service has no endpoints', () => {
    const ag = { relayMiner: { domain: 'RM1.Nodefleet.net' }, addressGroupServices: [{ service: { endpoints: [] } }] } as unknown as AddressGroupsJson[number]
    expect(extractDomainsForAddressGroup(ag)).toEqual(['nodefleet.net'])
  })
})
