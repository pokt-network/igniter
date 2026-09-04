import {
  assertDelegatorIsSigner,
  buildDelegateMessage,
  buildRedelegateMessage,
  buildUndelegateMessage,
  buildWithdrawRewardMessages,
  poktToUpokt,
} from './messages'

describe('poktToUpokt', () => {
  it('converts whole and fractional POKT to integer upokt', () => {
    expect(poktToUpokt('1')).toBe('1000000')
    expect(poktToUpokt('0.5')).toBe('500000')
    expect(poktToUpokt('12.345678')).toBe('12345678')
    expect(poktToUpokt(' 3 ')).toBe('3000000')
  })

  it('does not drift on amounts that break float math', () => {
    expect(poktToUpokt('0.1')).toBe('100000')
    expect(poktToUpokt('1000000.000001')).toBe('1000000000001')
  })

  it('rejects zero, negatives, too many decimals and garbage', () => {
    expect(() => poktToUpokt('0')).toThrow()
    expect(() => poktToUpokt('-1')).toThrow()
    expect(() => poktToUpokt('1.1234567')).toThrow()
    expect(() => poktToUpokt('abc')).toThrow()
    expect(() => poktToUpokt('')).toThrow()
  })
})

describe('message builders', () => {
  it('builds delegate / undelegate with cosmos staking type urls', () => {
    expect(buildDelegateMessage('pokt1d', 'poktvaloper1v', '5')).toEqual({
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      body: { delegatorAddress: 'pokt1d', validatorAddress: 'poktvaloper1v', amount: '5' },
    })
    expect(buildUndelegateMessage('pokt1d', 'poktvaloper1v', '5').typeUrl).toBe('/cosmos.staking.v1beta1.MsgUndelegate')
  })

  it('builds redelegate with src and dst', () => {
    expect(buildRedelegateMessage('pokt1d', 'poktvaloper1a', 'poktvaloper1b', '7').body).toEqual({
      delegatorAddress: 'pokt1d',
      validatorSrcAddress: 'poktvaloper1a',
      validatorDstAddress: 'poktvaloper1b',
      amount: '7',
    })
  })

  it('builds one withdraw message per validator', () => {
    const msgs = buildWithdrawRewardMessages('pokt1d', ['poktvaloper1a', 'poktvaloper1b'])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      body: { delegatorAddress: 'pokt1d', validatorAddress: 'poktvaloper1a' },
    })
  })
})

describe('assertDelegatorIsSigner', () => {
  it('passes when every delegator equals signer', () => {
    expect(() =>
      assertDelegatorIsSigner(
        [buildDelegateMessage('pokt1d', 'v', '1'), ...buildWithdrawRewardMessages('pokt1d', ['v'])],
        'pokt1d',
      ),
    ).not.toThrow()
  })

  it('throws on any mismatch', () => {
    expect(() => assertDelegatorIsSigner([buildUndelegateMessage('pokt1other', 'v', '1')], 'pokt1d')).toThrow(
      /does not match signer/,
    )
  })
})
