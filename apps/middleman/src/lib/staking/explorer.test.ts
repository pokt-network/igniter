import { explorerAccountUrl, explorerBaseUrl, explorerValidatorUrl } from './explorer'

describe('explorer urls', () => {
  it('maps mainnet to the explorer root', () => {
    expect(explorerBaseUrl('pocket')).toBe('https://explorer.pocket.network')
    expect(explorerAccountUrl('pocket', 'pokt1abc')).toBe('https://explorer.pocket.network/account/pokt1abc')
  })

  it('maps both beta chain ids to the beta explorer', () => {
    expect(explorerAccountUrl('pocket-beta', 'pokt1abc')).toBe('https://explorer.pocket.network/beta/account/pokt1abc')
    expect(explorerAccountUrl('pocket-lego-testnet', 'pokt1abc')).toBe(
      'https://explorer.pocket.network/beta/account/pokt1abc',
    )
  })

  it('builds validator urls from the operator address', () => {
    expect(explorerValidatorUrl('pocket', 'poktvaloper1abc')).toBe(
      'https://explorer.pocket.network/validator/poktvaloper1abc',
    )
  })

  it('returns null for chains with no public explorer and for a missing chain', () => {
    expect(explorerBaseUrl('pocket-alpha')).toBeNull()
    expect(explorerAccountUrl('pocket-alpha', 'pokt1abc')).toBeNull()
    expect(explorerValidatorUrl(undefined, 'poktvaloper1abc')).toBeNull()
    expect(explorerBaseUrl('something-else')).toBeNull()
  })
})
