import { TransactionStatus } from '@igniter/db/middleman/enums'
import { parseTransactionUpdatePatch } from './transactionUpdatePatch'
import { delegatorActivities } from './index'
import type DAL from '@/lib/dal/DAL'
import type { ProviderService } from '@/lib/provider'
import type { PocketBlockchain } from '@igniter/pocket'

jest.mock('@temporalio/activity', () => {
  class ApplicationFailure extends Error {
    type?: string
    static nonRetryable(message: string, type: string) {
      const e = new ApplicationFailure(message); e.type = type; return e
    }
  }
  return { log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }, ApplicationFailure }
})

const HASH = 'A'.repeat(64)

describe('parseTransactionUpdatePatch', () => {
  it('keeps the fields ExecuteTransaction writes', () => {
    expect(parseTransactionUpdatePatch({ status: TransactionStatus.Failure, log: 'x', code: 5 }))
      .toEqual({ status: TransactionStatus.Failure, log: 'x', code: 5 })
    expect(parseTransactionUpdatePatch({ executionHeight: 10, hash: HASH, timeoutHeight: null }))
      .toEqual({ executionHeight: 10, hash: HASH, timeoutHeight: null })
  })

  it.each([
    ['signedPayload', { signedPayload: 'x' }],
    ['unsignedPayload', { unsignedPayload: 'x' }],
    ['providerId', { providerId: 'x' }],
    ['createdBy', { createdBy: 1 }],
    ['a success status', { status: TransactionStatus.Success }],
    ['a non-hex hash', { hash: 'zz' }],
    ['a fractional height', { executionHeight: 1.5 }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseTransactionUpdatePatch(payload)).toThrow()
  })

  it('rejects a non-object payload', () => {
    expect(() => parseTransactionUpdatePatch(null)).toThrow()
    expect(() => parseTransactionUpdatePatch([])).toThrow()
  })
})

describe('updateTransaction activity', () => {
  function make(status: TransactionStatus) {
    const updateTransaction = jest.fn().mockResolvedValue(undefined)
    const dal = {
      transaction: { getTransaction: jest.fn().mockResolvedValue({ id: 1, status }), updateTransaction },
    } as unknown as DAL
    const activities = delegatorActivities(dal, {} as PocketBlockchain, {} as ProviderService)
    return { activities, updateTransaction }
  }

  it('writes only the parsed patch for a pending transaction', async () => {
    const { activities, updateTransaction } = make(TransactionStatus.Pending)
    await activities.updateTransaction(1, { status: TransactionStatus.Failure, log: 'boom' })
    expect(updateTransaction).toHaveBeenCalledWith(1, { status: TransactionStatus.Failure, log: 'boom' })
  })

  it('rejects a mass-assignment payload non-retryably without writing', async () => {
    const { activities, updateTransaction } = make(TransactionStatus.Pending)
    await expect(activities.updateTransaction(1, { signedPayload: 'x' } as never)).rejects.toMatchObject({ type: 'invalid_update' })
    expect(updateTransaction).not.toHaveBeenCalled()
  })

  it('does not rewrite a terminal transaction', async () => {
    const { activities, updateTransaction } = make(TransactionStatus.Success)
    await activities.updateTransaction(1, { status: TransactionStatus.Failure })
    expect(updateTransaction).not.toHaveBeenCalled()
  })
})
