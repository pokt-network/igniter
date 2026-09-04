import { parseDelegations, parseRewards, parseUnbonding, parseValidators, sortValidators, type ValidatorSummary } from './parse'

describe('parseValidators', () => {
  it('maps REST validator shape to summary', () => {
    const out = parseValidators({
      validators: [
        {
          operator_address: 'poktvaloper1a',
          jailed: false,
          status: 'BOND_STATUS_BONDED',
          tokens: '5000000',
          description: { moniker: 'Alpha', website: 'https://a', details: 'd' },
          commission: { commission_rates: { rate: '0.050000000000000000' } },
        },
        { operator_address: 'poktvaloper1b', status: 'BOND_STATUS_UNBONDED', tokens: '1', description: {} },
      ],
    })
    expect(out[0]).toEqual({
      operatorAddress: 'poktvaloper1a',
      moniker: 'Alpha',
      website: 'https://a',
      details: 'd',
      status: 'bonded',
      jailed: false,
      tokens: '5000000',
      commissionRate: 0.05,
    })
    expect(out[1]!.moniker).toBe('poktvaloper1b')
    expect(out[1]!.status).toBe('unbonded')
    expect(out[1]!.commissionRate).toBe(0)
  })

  it('returns empty for missing list', () => {
    expect(parseValidators({})).toEqual([])
  })
})

describe('parseDelegations', () => {
  it('keeps upokt balances only', () => {
    expect(
      parseDelegations({
        delegation_responses: [
          { delegation: { validator_address: 'v1', shares: '1' }, balance: { denom: 'upokt', amount: '100' } },
          { delegation: { validator_address: 'v2', shares: '1' }, balance: { denom: 'other', amount: '5' } },
        ],
      }),
    ).toEqual([{ validatorAddress: 'v1', amount: '100' }])
  })
})

describe('parseUnbonding', () => {
  it('flattens entries per validator', () => {
    expect(
      parseUnbonding({
        unbonding_responses: [
          {
            validator_address: 'v1',
            entries: [
              { balance: '10', completion_time: '2026-10-01T00:00:00Z' },
              { balance: '20', completion_time: '2026-10-02T00:00:00Z' },
            ],
          },
        ],
      }),
    ).toEqual([
      { validatorAddress: 'v1', amount: '10', completionTime: '2026-10-01T00:00:00Z' },
      { validatorAddress: 'v1', amount: '20', completionTime: '2026-10-02T00:00:00Z' },
    ])
  })
})

describe('parseRewards', () => {
  it('truncates DecCoin to integer upokt and drops zero rewards', () => {
    expect(
      parseRewards({
        rewards: [
          { validator_address: 'v1', reward: [{ denom: 'upokt', amount: '1234.567' }] },
          { validator_address: 'v2', reward: [] },
          { validator_address: 'v3', reward: [{ denom: 'upokt', amount: '0.9' }] },
        ],
        total: [],
      }),
    ).toEqual([{ validatorAddress: 'v1', amount: '1234' }])
  })
})

describe('sortValidators', () => {
  const v = (
    operatorAddress: string,
    status: ValidatorSummary['status'],
    tokens: string,
    jailed = false,
  ): ValidatorSummary => ({
    operatorAddress,
    moniker: operatorAddress,
    website: '',
    details: '',
    status,
    jailed,
    tokens,
    commissionRate: 0,
  })

  it('puts bonded validators first, then jailed, unbonding, unbonded', () => {
    const out = sortValidators([
      v('unbonded', 'unbonded', '900'),
      v('jailed', 'bonded', '800', true),
      v('bonded', 'bonded', '100'),
      v('unbonding', 'unbonding', '700'),
    ])
    expect(out.map((x) => x.operatorAddress)).toEqual(['bonded', 'jailed', 'unbonding', 'unbonded'])
  })

  it('orders by stake descending inside a group, without float precision loss', () => {
    const out = sortValidators([
      v('small', 'bonded', '1000000000000000001'),
      v('big', 'bonded', '1000000000000000002'),
    ])
    expect(out.map((x) => x.operatorAddress)).toEqual(['big', 'small'])
  })

  it('does not mutate the input array', () => {
    const input = [v('a', 'unbonded', '1'), v('b', 'bonded', '2')]
    sortValidators(input)
    expect(input.map((x) => x.operatorAddress)).toEqual(['a', 'b'])
  })
})
