import { explorerTxUrl } from './explorer'

const HASH = '88C325E601B353E72565C1F6849C993F6111E81C9B19D9344D48259FB6D776D7'

describe('explorerTxUrl', () => {
  it('links mainnet transactions to the Pocket explorer', () => {
    expect(explorerTxUrl('pocket', HASH)).toBe(`https://explorer.pocket.network/tx/${HASH}`)
  })

  it.each(['pocket-beta', 'pocket-lego-testnet'])('links %s (the beta testnet) to the explorer beta view', (chainId) => {
    expect(explorerTxUrl(chainId, HASH)).toBe(`https://explorer.pocket.network/beta/tx/${HASH}`)
  })

  it.each([['pocket-alpha'], ['unknown'], [undefined], [null]])('has no link for %s', (chainId) => {
    expect(explorerTxUrl(chainId, HASH)).toBeNull()
  })

  it('has no link for an empty hash', () => {
    expect(explorerTxUrl('pocket', '')).toBeNull()
  })
})
