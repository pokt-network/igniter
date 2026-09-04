/**
 * Parsers for Cosmos SDK REST (gRPC-gateway) responses used by the validators
 * page. Amounts are returned in upokt as strings; the UI converts for display.
 */

export interface ValidatorSummary {
  operatorAddress: string
  moniker: string
  website: string
  details: string
  status: 'bonded' | 'unbonding' | 'unbonded'
  jailed: boolean
  /** upokt */
  tokens: string
  /** 0..1 */
  commissionRate: number
}

export interface DelegationSummary {
  validatorAddress: string
  /** upokt */
  amount: string
}

export interface UnbondingEntry {
  validatorAddress: string
  /** upokt */
  amount: string
  completionTime: string
}

export interface RewardSummary {
  validatorAddress: string
  /** upokt, integer part only */
  amount: string
}

const BOND_STATUS: Record<string, ValidatorSummary['status']> = {
  BOND_STATUS_BONDED: 'bonded',
  BOND_STATUS_UNBONDING: 'unbonding',
  BOND_STATUS_UNBONDED: 'unbonded',
}

export function parseValidators(raw: any): ValidatorSummary[] {
  const list: any[] = raw?.validators ?? []
  return list.map((v) => ({
    operatorAddress: v.operator_address,
    moniker: v.description?.moniker || v.operator_address,
    website: v.description?.website ?? '',
    details: v.description?.details ?? '',
    status: BOND_STATUS[v.status] ?? 'unbonded',
    jailed: Boolean(v.jailed),
    tokens: v.tokens ?? '0',
    commissionRate: Number(v.commission?.commission_rates?.rate ?? 0),
  }))
}

export function parseDelegations(raw: any): DelegationSummary[] {
  const list: any[] = raw?.delegation_responses ?? []
  return list
    .filter((d) => d.balance?.denom === 'upokt')
    .map((d) => ({
      validatorAddress: d.delegation.validator_address,
      amount: d.balance.amount,
    }))
}

export function parseUnbonding(raw: any): UnbondingEntry[] {
  const list: any[] = raw?.unbonding_responses ?? []
  return list.flatMap((u) =>
    (u.entries ?? []).map((e: any) => ({
      validatorAddress: u.validator_address,
      amount: e.balance,
      completionTime: e.completion_time,
    })),
  )
}

/** Distribution returns DecCoins ("123.456upokt" split as amount "123.456"). Keep integer upokt. */
export function parseRewards(raw: any): RewardSummary[] {
  const list: any[] = raw?.rewards ?? []
  return list
    .map((r) => {
      const coin = (r.reward ?? []).find((c: any) => c.denom === 'upokt')
      const integer = (coin ? String(coin.amount).split('.')[0] : undefined) ?? '0'
      return { validatorAddress: r.validator_address, amount: integer }
    })
    .filter((r) => r.amount !== '0')
}
