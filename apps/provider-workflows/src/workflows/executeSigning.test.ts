/**
 * Signing with the key loaded from the keys table, end to end at workflow level: ExecutePendingTransactions → ExecuteTransaction →
 * the REAL signSupplierTx / broadcastSupplierTx activities, over an in-memory DAL whose
 * transaction rows hold no private key. Proves the dispatcher still signs (with the key
 * loaded from the keys table) and broadcasts.
 *
 * There is no Temporal test harness in this repo (@temporalio/testing is not a dependency),
 * so the workflows run as plain async functions with proxyActivities/executeChild stubbed.
 * That covers the call chain and the branch logic, not determinism/replay.
 */

let realActivities: Record<string, (...a: any[]) => any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_t, name: string) => realActivities[name] }),
  executeChild: async (_name: string, opts: { args: [{ transactionId: number }] }) => {
    const { ExecuteTransaction } = jest.requireActual('./ExecuteTransaction') as typeof import('./ExecuteTransaction')
    return ExecuteTransaction(opts.args[0])
  },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  ApplicationFailure: class extends Error {},
  WorkflowIdReusePolicy: {},
  ParentClosePolicy: {},
}))
jest.mock('p-limit', () => () => (fn: () => unknown) => fn())
jest.mock('@igniter/pocket', () => ({}))
jest.mock('@temporalio/activity', () => {
  const fail = (message: string, type?: string) => Object.assign(new Error(message), { type })
  return {
    ApplicationFailure: Object.assign(jest.fn(), { nonRetryable: jest.fn(fail), retryable: jest.fn(fail) }),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    Context: { current: () => ({ cancellationSignal: { throwIfAborted: () => undefined } }) },
    heartbeat: jest.fn(),
  }
})
jest.mock('@igniter/domain/provider/operations', () => ({
  BuildSupplierServiceConfigHandler: jest.fn(),
  CompareSupplierServiceConfigHandler: jest.fn(),
}))
jest.mock('@igniter/domain/provider/utils', () => ({ getExpectedServicesFromKey: jest.fn(() => []) }))
jest.mock('@/lib/redactors', () => ({ redactStakeSupplierParams: jest.fn() }))
jest.mock('@igniter/pocket/proto/pocket/shared/supplier', () => ({ ServiceConfigUpdate: {} }))

import { TransactionStatus, TransactionType } from '@igniter/db/provider/enums'
import { providerActivities } from '@/activities'
import { ExecutePendingTransactions } from './ExecutePendingTransactions'

const OP = 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723y'
const OWNER = 'pokt1qgpqyqszqgpqyqszqgpqyqszqgpqyqsz73c06j'
const DB_KEY = 'db-decrypted-private-key'

type AnyRecord = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(rows: AnyRecord[]) {
  const key = { id: 10, address: OP, privateKey: DB_KEY, stakeOwner: OWNER, ownerAddress: OWNER, retiredAt: null }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const dal = {
    keys: { loadKey: jest.fn(async () => key) },
    transactions: {
      listPending: jest.fn(async () => rows.filter((r) => r.status === TransactionStatus.Pending).map((r) => ({ id: r.id }))),
      getTransaction: jest.fn(async (id: number) => byId.get(id)),
      getTransactionStatus: jest.fn(async (id: number) => {
        const r = byId.get(id)
        return r && { status: r.status, hash: r.hash }
      }),
      recordSigned: jest.fn(async (id: number, f: AnyRecord) => Object.assign(byId.get(id)!, f)),
      abandonIntent: jest.fn(async (id: number) => { byId.get(id)!.status = TransactionStatus.Failure }),
      claimTerminalTransition: jest.fn(),
    },
  }
  const signed = (h: string) => ({ signedPayload: `bytes-${h}`, transactionHash: h, timeoutTimestamp: new Date(0) })
  const chain = {
    getHeight: jest.fn(async () => 100),
    getSpendableBalance: jest.fn(async () => 10_000),
    signSupplierTx: jest.fn(async () => signed('STAKE')),
    signUnstakeAndDrainTx: jest.fn(async () => signed('UNSTAKE')),
    signSendTx: jest.fn(async () => signed('SEND')),
    broadcastSupplierTx: jest.fn(async () => ({ rejected: false })),
  }
  realActivities = providerActivities(dal as never, chain as never) as never
  return { dal, chain }
}

describe('ExecutePendingTransactions signs and broadcasts key-less intent rows', () => {
  it('stake, unstake and return_funds rows are signed with the keys-table key and broadcast', async () => {
    const rows = [
      { id: 1, keyId: 10, keyAddress: OP, type: TransactionType.Stake, status: TransactionStatus.Pending, hash: null,
        params: JSON.stringify({ kind: 'stake', params: { signer: OP, ownerAddress: OWNER, operatorAddress: OP, services: [] } }) },
      { id: 2, keyId: 10, keyAddress: OP, type: TransactionType.Unstake, status: TransactionStatus.Pending, hash: null,
        params: JSON.stringify({ kind: 'unstake', params: { signer: OP, operatorAddress: OP }, returnFunds: { mode: 'owner' } }) },
      { id: 3, keyId: 10, keyAddress: OP, type: TransactionType.ReturnFunds, status: TransactionStatus.Pending, hash: null,
        params: JSON.stringify({ kind: 'return_funds', params: { fromAddress: OP, toAddress: OWNER, amount: [] } }) },
    ]
    const { chain } = setup(rows)

    await ExecutePendingTransactions()

    expect(chain.signSupplierTx).toHaveBeenCalledWith(expect.objectContaining({ signerPrivateKey: DB_KEY }))
    expect(chain.signUnstakeAndDrainTx).toHaveBeenCalledWith(expect.objectContaining({ signerPrivateKey: DB_KEY, drainTo: OWNER }))
    expect(chain.signSendTx).toHaveBeenCalledWith(expect.objectContaining({ signerPrivateKey: DB_KEY, toAddress: OWNER }), 1000)
    expect(chain.broadcastSupplierTx.mock.calls.map((c) => (c as unknown[])[0] as string).sort()).toEqual(['bytes-SEND', 'bytes-STAKE', 'bytes-UNSTAKE'])
    expect(rows.map((r) => r.hash)).toEqual(['STAKE', 'UNSTAKE', 'SEND'])
    for (const r of rows) expect(r.params).not.toContain('signerPrivateKey')
  })

  it('a row whose signer is another key is abandoned and never broadcast', async () => {
    const other = 'pokt1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrlpewsn'
    const rows = [
      { id: 4, keyId: 10, keyAddress: OP, type: TransactionType.Unstake, status: TransactionStatus.Pending, hash: null,
        params: JSON.stringify({ kind: 'unstake', params: { signer: other, operatorAddress: other }, returnFunds: { mode: 'none' } }) },
    ]
    const { chain, dal } = setup(rows)

    await ExecutePendingTransactions()

    expect(dal.transactions.abandonIntent).toHaveBeenCalledWith(4, expect.anything())
    expect(chain.signUnstakeAndDrainTx).not.toHaveBeenCalled()
    expect(chain.broadcastSupplierTx).not.toHaveBeenCalled()
  })
})
