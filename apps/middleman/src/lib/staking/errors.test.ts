import { humanizeChainError } from './errors'

describe('humanizeChainError', () => {
  const redelegationInProgress =
    'Gas simulation failed (500): {"code":2,"message":"failed to execute message; message index: 0: redelegation to this validator already in progress; first redelegation to this validator must complete before next redelegation [cosmos/cosmos-sdk@v0.53.7/baseapp/baseapp.go:1052] with gas used: \'42676\'","details":[]}'

  it('explains a redelegation still maturing', () => {
    expect(humanizeChainError(redelegationInProgress)).toBe(
      'A redelegation to this validator is still maturing. Wait for it to complete, or pick a different destination validator.',
    )
  })

  it('explains insufficient funds', () => {
    expect(humanizeChainError('{"code":5,"message":"insufficient funds: insufficient account balance"}')).toBe(
      'Not enough POKT in this account to cover the amount plus the transaction fee.',
    )
  })

  it('strips the sdk source reference from an unrecognised message', () => {
    expect(
      humanizeChainError('{"code":9,"message":"something odd happened [cosmos/cosmos-sdk@v0.53.7/x/staking.go:12]"}'),
    ).toBe('something odd happened')
  })

  it('passes through plain messages that carry no envelope', () => {
    expect(humanizeChainError('Wallet is locked or not responding.')).toBe('Wallet is locked or not responding.')
  })

  it('falls back to the raw text when the envelope is unparseable', () => {
    expect(humanizeChainError('Broadcast failed (503): {not json')).toBe('Broadcast failed (503): {not json')
  })
})
