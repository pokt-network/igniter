import { CompareSupplierServiceConfigHandler } from '@igniter/domain/provider/operations'
import { rPCTypeFromJSON } from '@igniter/pocket'
import type { SupplierServiceConfig } from '@igniter/pocket'
import type { SupplierPathOutcome } from '@igniter/tx-verify'
import { extractTransactionStakingSuppliers } from '@/workflows/utils'
import type { Transaction } from '@igniter/db/middleman/schema'

type StakeMsgService = {
  serviceId: string
  endpoints: Array<{ url: string; rpcType: string | number; configs?: Array<{ key: string | number; value: string }> }>
  revShare: Array<{ address: string; revSharePercentage: string | number }>
}

/** Normalizes a tx-message service config (JSON shapes: rpcType string, revShare string) to the proto shape the comparator expects. */
function normalizeMsgServiceConfig(svc: StakeMsgService): SupplierServiceConfig {
  return {
    serviceId: svc.serviceId,
    endpoints: svc.endpoints.map((e) => ({
      url: e.url,
      rpcType: rPCTypeFromJSON(e.rpcType),
      configs: (e.configs ?? []).map((c) => ({ key: Number(c.key), value: c.value })),
    })),
    revShare: svc.revShare.map((r) => ({ address: r.address, revSharePercentage: Number(r.revSharePercentage) })),
  }
}

type SupplierOnChain = {
  ownerAddress: string
  stake?: { amount: string } | null
  services: SupplierServiceConfig[]
  serviceConfigHistory?: Array<{ service?: SupplierServiceConfig | null }>
} | null

/**
 * Goal-state verification for a (possibly multi-supplier) stake tx: EVERY operator
 * must exist on-chain, owner-match, have stake >= the message amount, and its
 * on-chain services (or pending serviceConfigHistory entry) must canonically equal
 * the message's service configs. On-chain state literally equal to intended state
 * = goal met regardless of WHICH tx achieved it (goal-state semantics).
 */
export async function verifyStakeGoalState(
  txn: Pick<Transaction, 'unsignedPayload'>,
  getSupplier: (address: string) => Promise<SupplierOnChain>,
): Promise<SupplierPathOutcome> {
  const intents = extractTransactionStakingSuppliers(txn as Transaction)
  if (intents.length === 0) return { status: 'absent' }
  const compare = new CompareSupplierServiceConfigHandler()
  const absentOperators: string[] = []
  for (const intent of intents) {
    let supplier: SupplierOnChain
    try {
      supplier = await getSupplier(intent.address)
    } catch {
      return { status: 'unavailable' }
    }
    if (!supplier || supplier.ownerAddress !== intent.ownerAddress
        || BigInt(supplier.stake?.amount ?? '0') < BigInt(intent.stakeAmount)) {
      absentOperators.push(intent.address)
      continue
    }
    const intended = (intent.services as StakeMsgService[]).map(normalizeMsgServiceConfig)
    const active = compare.execute({ serviceConfigSetA: intended, serviceConfigSetB: supplier.services }).isEqual
    const pendingActivation = (supplier.serviceConfigHistory ?? []).some((h) => {
      const historyServices = h.service ? [h.service] : []
      return historyServices.length > 0 && compare.execute({ serviceConfigSetA: intended, serviceConfigSetB: historyServices }).isEqual
    })
    if (!active && !pendingActivation) absentOperators.push(intent.address)
  }
  return absentOperators.length === 0
    ? { status: 'confirmed' }
    : { status: 'absent', absentOperators }
}
