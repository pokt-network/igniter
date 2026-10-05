import { supplierRewardAmount, supplierRewardShare } from './supplierRewardShare'

// Mainnet values as the indexer returns them (param.value), since height 636543.
const CLAIM_DISTRIBUTION = '{"dao":0.045,"proposer":0.14,"supplier":0.79,"source_owner":0.025,"application":0}'
const MINT_RATIO = '0.975'

describe('supplierRewardShare', () => {
  it('is mint_ratio x mint_equals_burn_claim_distribution.supplier', () => {
    expect(supplierRewardShare(CLAIM_DISTRIBUTION, MINT_RATIO)).toBeCloseTo(0.77025, 10)
  })

  it('turns 1000 upokt of gross rewards into 770 for the supplier', () => {
    expect(supplierRewardAmount(1000, supplierRewardShare(CLAIM_DISTRIBUTION, MINT_RATIO))).toBe('770')
  })

  it('throws when the claim distribution param is missing', () => {
    expect(() => supplierRewardShare(undefined, MINT_RATIO)).toThrow('mint_equals_burn_claim_distribution')
    expect(() => supplierRewardShare('{"dao":0.045}', MINT_RATIO)).toThrow('mint_equals_burn_claim_distribution')
  })

  it('throws when mint_ratio is missing', () => {
    expect(() => supplierRewardShare(CLAIM_DISTRIBUTION, null)).toThrow('mint_ratio')
    expect(() => supplierRewardShare(CLAIM_DISTRIBUTION, 'abc')).toThrow('mint_ratio')
  })
})
