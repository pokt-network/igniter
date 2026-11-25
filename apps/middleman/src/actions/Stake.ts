'use server'

import { getApplicationSettings } from '@/actions/ApplicationSettings'
import { getByIdentity as getProviderByIdentity, list as listProviders } from '@/lib/dal/providers'
import {
  StakeDistributionItem,
  StakeDistributionOffer,
} from '@/lib/models/StakeDistributionOffer'
import {
  SignedMemo,
  SignedMemoPayload,
  SignedTransaction,
} from '@igniter/ui/models'
import { InsertTransaction } from '@igniter/db/middleman/schema'
import {
  ProviderFee,
  TransactionStatus,
  TransactionType,
} from '@igniter/db/middleman/enums'
import { insert } from '@/lib/dal/transaction'
import { requireAuth } from '@/lib/utils/actions'
import { governance } from '@/lib/governance'
import {
  getCompressedPublicKeyFromAppIdentity,
  signPayload,
} from '@igniter/commons/crypto'
import { getLogger } from '@igniter/logger'
import { runWithRequestContext } from '@/lib/logging/withLogging'
import { freshSupplierStats } from '@/lib/utils/shareCalculations'
import { assertSignedTransaction } from '@igniter/ui/lib/signedTransaction'
import { deriveStakeUnsignedPayload } from '@/lib/transactions/stakePayload'
import { getApplicationSettings as getServerSettings } from '@/lib/dal/applicationSettings'
import { fetchChainAccount } from '@/lib/transactions/chainAccount'

const log = getLogger(['middleman', 'stake'])

export interface CreateStakeTransactionRequest {
  offer: StakeDistributionOffer;
  transaction: SignedTransaction;
}

export async function CalculateStakeDistribution(stakeAmount: number, ownerAddress: string): Promise<StakeDistributionOffer[]> {
  await requireAuth()
  const applicationSettings = await getApplicationSettings()
  const providers = await listProviders()

  const availableNodeSizes = [applicationSettings.minimumStake]

  return providers
    .filter(provider => provider.enabled)
    .map(provider => {
      let distribution: StakeDistributionItem[] = []

      // Filter address groups to only include public ones
      const publicAddressGroups = (provider.addressGroups || []).filter(group =>
        group.private === false && (
          !group.linkedAddresses ||
          group.linkedAddresses.length === 0 ||
          group.linkedAddresses.some((address) => address.toLowerCase() === ownerAddress.toLowerCase())
        )
      )

      // Skip providers that don't have any public address groups
      if (publicAddressGroups.length === 0) {
        return null
      }

      const ownerCanStakeWithProvider =
          provider.allowPublicStaking ||
          provider.allowedStakers?.some((address: string) => address.toLowerCase() === ownerAddress.toLowerCase());

      if (!ownerCanStakeWithProvider) {
        distribution = [];
      }

      if (provider.enabled && provider.operationalFunds && provider.minimumStake && ownerCanStakeWithProvider) {

        const allowedSizes = availableNodeSizes.filter(amount => amount >= provider.minimumStake)

        let remaining = stakeAmount

        distribution = allowedSizes.reduce((acc: StakeDistributionItem[], nodeAmount: number) => {
          if (remaining <= 0) return acc
          const qty = Math.floor(remaining / nodeAmount)
          if (qty > 0) {
            acc.push({ amount: nodeAmount, qty })
            remaining -= qty * nodeAmount
          }
          return acc
        }, [])

        if (remaining !== 0) {
          distribution = []
        }
      }

      const offer: StakeDistributionOffer = {
        id: provider.id,
        identity: provider.identity,
        name: provider.name,
        fee: provider.fee!,
        feeType: provider.feeType || ProviderFee.Fixed,
        regions: provider.regions || [],
        rewards: 'N/A',
        operationalFundsAmount: provider.operationalFunds,
        status: provider.status,
        stakeDistribution: distribution,
        addressGroups: publicAddressGroups,
        supplierStats: freshSupplierStats(provider.supplierStats),
      }
      return offer
    })
    .filter((offer): offer is StakeDistributionOffer => offer !== null)
}

export async function CreateStakeTransaction(request: CreateStakeTransactionRequest) {
  return runWithRequestContext(async () => {
    const userIdentity = await requireAuth()

    log.info('stake transaction requested', {
      ownerAddress: request.transaction.address,
      providerId: request.offer.identity,
      estimatedFee: request.transaction.estimatedFee,
    })

    assertSignedTransaction(request.transaction)

    // The provider identity comes from the client: only a provider in the governance source is accepted.
    const governed = await governance.resolve(request.offer.identity)
    if (!governed) {
      throw new Error('The provider is not in the governance source')
    }

    // The fee is the provider's, as this middleman stores it; the offer the client echoes back is not.
    const provider = await getProviderByIdentity(governed.identity)
    if (!provider) {
      throw new Error('The provider is not available')
    }

    // The stored messages come from the signed bytes, never from the client's unsigned copy: the
    // workflows release and verify the operators those messages name. The signature is verified
    // and the sender is the address of the signing key, not the address the client names.
    const { chainId } = await getServerSettings()
    const { unsignedPayload, fromAddress } = await deriveStakeUnsignedPayload(
      request.transaction.signedPayload,
      request.transaction.address,
      { chainId, getAccountNumber: async (address) => (await fetchChainAccount(address)).accountNumber },
    )

    const created = await insert({
      type: TransactionType.Stake,
      status: TransactionStatus.Pending,
      signedPayload: request.transaction.signedPayload,
      fromAddress,
      unsignedPayload,
      providerFee: Number(provider.fee),
      providerId: governed.identity,
      estimatedFee: request.transaction.estimatedFee,
      consumedFee: 0,
      typeProviderFee: provider.feeType || ProviderFee.Fixed,
      createdBy: userIdentity,
    })

    log.info('stake transaction created', {
      transactionId: created.id,
      ownerAddress: fromAddress,
      providerId: request.offer.identity,
    })

    return created
  })
}

// The memo carries the delegator rewards address and fee of THIS middleman, signed with its
// key, so both come from the server's settings; the client is never asked for them.
export async function CreateSignedMemo(): Promise<SignedMemo> {
  await requireAuth()
  const settings = await getApplicationSettings()

  const signedMemoPayload: SignedMemoPayload = {
    t: new Date().toISOString(),
    a: settings.delegatorRewardsAddress!,
    f: settings.fee?.toString() ?? '',
  }

  const canonicalPayload = JSON.stringify(
    Object.fromEntries(Object.entries(signedMemoPayload).sort()),
  )

  const signature = await signPayload(JSON.stringify(canonicalPayload))

  const publicKey = await getCompressedPublicKeyFromAppIdentity()

  return {
    ...signedMemoPayload,
    s: signature.toString('base64url'),
    p: publicKey.toString('base64url'),
  }
}
