import { log, proxyActivities } from '@temporalio/workflow'
import { providerActivities } from '@/activities'
import { classifyStatusResults, buildStatusNotificationEvents } from '@/workflows/supplierStatusUtils'

// @ts-ignore
import pLimit from 'p-limit'

export interface SupplierStatusForAddressesInput {
  addresses: string[]
}

export async function SupplierStatusForAddresses(
  input: SupplierStatusForAddressesInput,
): Promise<void> {
  const { getLatestBlock, upsertSupplierStatus } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '10s',
      retry: { maximumAttempts: 10 },
    })

  const { sendNotifications: sendNotificationsBestEffort } =
    proxyActivities<ReturnType<typeof providerActivities>>({
      startToCloseTimeout: '30s',
      retry: { maximumAttempts: 1 },
    })

  log.info('SupplierStatusForAddresses: started', { addresses: input.addresses })

  const height = await getLatestBlock()

  const limit = pLimit(10)
  const settled = await Promise.allSettled(
    input.addresses.map((address) =>
      limit(() => upsertSupplierStatus({ address, height })),
    ),
  )

  const result = classifyStatusResults(settled, input.addresses)

  for (const event of buildStatusNotificationEvents(result, height)) {
    await sendNotificationsBestEffort(event)
  }

  log.info('SupplierStatusForAddresses: finished', { height, result })
}