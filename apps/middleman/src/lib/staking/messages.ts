import type { TransactionMessage } from '@igniter/ui/models'

export const STAKING_MSG = {
  delegate: '/cosmos.staking.v1beta1.MsgDelegate',
  undelegate: '/cosmos.staking.v1beta1.MsgUndelegate',
  redelegate: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  withdrawReward: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
} as const

/**
 * Converts a user-entered POKT amount (decimal string) into an integer upokt
 * string without floating point drift. Rejects negatives, zero, and more than
 * 6 fractional digits.
 */
export function poktToUpokt(pokt: string): string {
  const trimmed = pokt.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid POKT amount: ${pokt}`)
  }
  const [whole = '0', frac = ''] = trimmed.split('.')
  const upokt = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))
  if (upokt <= 0n) {
    throw new Error('Amount must be greater than zero')
  }
  return upokt.toString()
}

export function buildDelegateMessage(delegatorAddress: string, validatorAddress: string, upokt: string): TransactionMessage {
  return { typeUrl: STAKING_MSG.delegate, body: { delegatorAddress, validatorAddress, amount: upokt } }
}

export function buildUndelegateMessage(delegatorAddress: string, validatorAddress: string, upokt: string): TransactionMessage {
  return { typeUrl: STAKING_MSG.undelegate, body: { delegatorAddress, validatorAddress, amount: upokt } }
}

export function buildRedelegateMessage(
  delegatorAddress: string,
  validatorSrcAddress: string,
  validatorDstAddress: string,
  upokt: string,
): TransactionMessage {
  return {
    typeUrl: STAKING_MSG.redelegate,
    body: { delegatorAddress, validatorSrcAddress, validatorDstAddress, amount: upokt },
  }
}

/** One withdraw message per validator with pending rewards. */
export function buildWithdrawRewardMessages(delegatorAddress: string, validatorAddresses: string[]): TransactionMessage[] {
  return validatorAddresses.map((validatorAddress) => ({
    typeUrl: STAKING_MSG.withdrawReward,
    body: { delegatorAddress, validatorAddress },
  }))
}

/**
 * Every staking/distribution message must name the signer as delegator. Wallets
 * differ on mismatch (chain rejects for Keplr, Soothe may override silently), so
 * fail here before any signature is requested.
 */
export function assertDelegatorIsSigner(messages: TransactionMessage[], signer: string): void {
  for (const m of messages) {
    if ('delegatorAddress' in m.body && m.body.delegatorAddress !== signer) {
      throw new Error(`Message delegator ${m.body.delegatorAddress} does not match signer ${signer}`)
    }
  }
}
