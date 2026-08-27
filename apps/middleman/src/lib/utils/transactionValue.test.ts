import { resolveTransactionTotalValue, sumOperationsValue } from './transactionValue';
import { MessageType } from '@igniter/commons/constants';
import type { Operation } from '@/app/detail/TransactionDetail';

const stakeOp = (amount: string) => ({
  typeUrl: MessageType.Stake,
  value: { stake: { amount } },
}) as unknown as Operation;

const sendOp = (amount: string) => ({
  typeUrl: MessageType.Send,
  value: { amount: [{ amount }] },
}) as unknown as Operation;

const unstakeOp = () => ({
  typeUrl: MessageType.Unstake,
  value: { operatorAddress: 'pokt1abc', signer: 'pokt1owner' },
}) as unknown as Operation;

describe('resolveTransactionTotalValue', () => {
  it('prefers the stored amount over the payload', () => {
    expect(resolveTransactionTotalValue('9300000000000', () => 42)).toBe(9300000000000);
  });

  it('keeps full precision for amounts that overflow int4', () => {
    // 9.3M POKT in uPOKT — the case from the original report
    expect(resolveTransactionTotalValue('9300000000000', () => 0)).toBe(9_300_000_000_000);
  });

  it('falls back to the payload when the amount is null (legacy rows)', () => {
    expect(resolveTransactionTotalValue(null, () => 42)).toBe(42);
    expect(resolveTransactionTotalValue(undefined, () => 42)).toBe(42);
    expect(resolveTransactionTotalValue('', () => 42)).toBe(42);
  });

  it('falls back when the stored amount is not a number', () => {
    expect(resolveTransactionTotalValue('not-a-number', () => 42)).toBe(42);
  });

  it('treats a stored zero as unset, matching the writers', () => {
    // The shared query returns null instead of a zero total and the workflow
    // self-heal treats '0' as still-unhealed; the reader must not disagree.
    expect(resolveTransactionTotalValue('0', () => 42)).toBe(42);
    expect(resolveTransactionTotalValue('000', () => 42)).toBe(42);
  });

  // Number() accepts far more than uPOKT ever is, and a stored amount is
  // authoritative once accepted — it suppresses the fallback for good and the
  // workflow self-heal stops revisiting the row. So anything that is not a
  // plain run of digits has to fall back instead of being coerced.
  it.each([
    ['whitespace only', '   '],
    ['hexadecimal', '0x10'],
    ['scientific notation', '1e3'],
    ['negative', '-5'],
    ['Infinity', 'Infinity'],
    ['fractional', '1.5'],
    ['digits with trailing junk', '123abc'],
  ])('falls back for a %s amount', (_label, stored) => {
    expect(resolveTransactionTotalValue(stored, () => 42)).toBe(42);
  });

  it('tolerates surrounding whitespace on an otherwise valid amount', () => {
    expect(resolveTransactionTotalValue(' 9300000000000 ', () => 42)).toBe(9_300_000_000_000);
  });

  it('falls back above MAX_SAFE_INTEGER rather than returning a rounded value', () => {
    // Number('9007199254740993') silently yields ...992. Total supply is far
    // below this, so falling back is the honest answer if it ever appears.
    expect(resolveTransactionTotalValue('9007199254740993', () => 42)).toBe(42);
  });

  it('does not invoke the payload fallback when a stored amount is present', () => {
    // The thunk exists to keep JSON.parse + reduce off the hot path; nothing
    // else pins that it stays lazy.
    const fallback = jest.fn(() => 42);

    expect(resolveTransactionTotalValue('9300000000000', fallback)).toBe(9_300_000_000_000);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('sumOperationsValue', () => {
  it('sums stake and send messages', () => {
    expect(sumOperationsValue([stakeOp('60000000000'), sendOp('1000000')])).toBe(60_001_000_000);
  });

  it('returns 0 for unstake messages, which carry no amount', () => {
    // This is the bug the stored amount exists to work around.
    expect(sumOperationsValue([unstakeOp(), unstakeOp()])).toBe(0);
  });

  it('returns 0 for an empty payload', () => {
    expect(sumOperationsValue([])).toBe(0);
  });

  it('includes the operational-funds Send that accompanies a Stake', () => {
    // Deliberate: the list column is the broad total. The detail drawer uses a
    // narrower, type-gated sum that excludes this Send.
    expect(sumOperationsValue([stakeOp('60000000000'), sendOp('1000000'), unstakeOp()]))
      .toBe(60_001_000_000);
  });

  it('treats a Send with no coins as zero', () => {
    const emptySend = { typeUrl: MessageType.Send, value: { amount: [] } } as unknown as Operation;

    expect(sumOperationsValue([emptySend])).toBe(0);
  });
});
