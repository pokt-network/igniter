import { proxyActivities } from '@temporalio/workflow'
import type { providerActivities } from '@/activities'
import { TransactionStatus } from '@igniter/db/provider/enums'

interface Args { transactionId: number }

export async function ExecuteTransaction({ transactionId }: Args) {
  const { getTransaction, signSupplierTx, broadcastSupplierTx, isSignedTxExpired, clearSignedTx } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '30s',
      retry: { maximumAttempts: 3 },
    })

  const txn = await getTransaction(transactionId)
  if (!txn || txn.status !== TransactionStatus.Pending) return // terminal / dedup

  // B1: hash set means "already signed" — go straight to broadcast, UNLESS expired.
  if (txn.hash) {
    if (await isSignedTxExpired(transactionId)) {
      await clearSignedTx(transactionId)   // A3: re-sign branch
      await signSupplierTx(transactionId)
      const afterSign = await getTransaction(transactionId)
      if (afterSign && afterSign.status === TransactionStatus.Pending && afterSign.hash) {
        await broadcastSupplierTx(transactionId)
      }
    } else {
      await broadcastSupplierTx(transactionId)
    }
  } else {
    await signSupplierTx(transactionId)
    const afterSign = await getTransaction(transactionId)
    if (afterSign && afterSign.status === TransactionStatus.Pending && afterSign.hash) {
      await broadcastSupplierTx(transactionId)
    }
  }
  // does NOT wait for verification — the sweeper owns the terminal transition.
}
