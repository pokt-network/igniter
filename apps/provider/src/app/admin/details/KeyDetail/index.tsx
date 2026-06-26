'use client';

import Amount from '@igniter/ui/components/Amount'
import React from 'react'
import { clsx } from 'clsx'
import { useQuery, skipToken } from '@tanstack/react-query'
import { DrawerDescription, DrawerHeader, DrawerTitle } from '@igniter/ui/components/drawer'
import Summary, { SummaryRow } from '@igniter/ui/components/Summary'
import { amountToPokt } from '@igniter/ui/lib/utils'
import Address from '@igniter/ui/components/Address'
import { Badge } from '@igniter/ui/components/badge'
import {KeyWithRelations} from "@igniter/db/provider/schema"
import {KeyState, KeyStateNameMap} from "@igniter/db/provider/enums"
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import { useAddItemToDetail } from "@igniter/ui/components/QuickDetails/Provider"
import { ListTransactionsByKey } from "@/actions/Transactions"
import {RemediationHistoryList} from "@/app/admin/details/KeyDetail/RemediationHistoryList";
import {KeyStateLabels, deriveKeyLifecycleStatus, RETIRED_LIFECYCLE_LABEL} from "@/app/admin/(internal)/keys/constants";
import PrivateKeyReveal from "@/app/admin/details/KeyDetail/PrivateKeyReveal"
import { MigrateKeyButton } from "@/app/admin/details/KeyDetail/MigrateKeyButton";
import { UnstakeKeyButton } from "@/app/admin/details/KeyDetail/UnstakeKeyButton";

export interface KeyDetail {
  type: 'key'
  body: KeyWithRelations
}

const stateColor: Record<string, string> = {
  [KeyState.Available]: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  [KeyState.Delivered]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.Staking]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.Staked]: 'bg-success/15 text-success border-success/30',
  [KeyState.StakeFailed]: 'bg-error/15 text-error border-error/30',
  [KeyState.AttentionNeeded]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.RemediationFailed]: 'bg-error/15 text-error border-error/30',
  [KeyState.Unstaking]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.Unstaked]: 'bg-bg-elevated text-text-secondary border-border-primary',
  [KeyState.Imported]: 'bg-bg-elevated text-text-secondary border-border-primary',
  [KeyState.MissingStake]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
}

const stateDescription: Partial<Record<KeyState, string>> = {
  [KeyState.Available]: 'This key is available to be staked. When a request for suppliers is received, this key is prioritized.',
  [KeyState.Imported]: 'This key was recently imported. The system will evaluate its on-chain state and set it accordingly.',
  [KeyState.Delivered]: 'This key has been delivered to a delegator for staking. Waiting for the stake transaction to be confirmed.',
  [KeyState.Staked]: 'This key is actively staked on the network. No issues detected.',
  [KeyState.MissingStake]: 'This key was delivered for staking over 24h ago, but no corresponding stake was found on-chain.',
  [KeyState.AttentionNeeded]: 'The system detected issues with this key. This does not necessarily mean the supplier is offline.',
  [KeyState.RemediationFailed]: 'Automatic remediation failed for this key. Manual review is recommended.',
  [KeyState.Unstaking]: 'This key is in the process of being unstaked from the network.',
  [KeyState.Unstaked]: 'This key has been unstaked from the network.',
}

const TX_TYPE_LABELS: Record<string, string> = {
  stake: 'Stake',
  unstake: 'Unstake',
  return_funds: 'Return Funds',
}

function txStatusVariant(status: string): 'success' | 'destructive' | 'warning' {
  if (status === 'success') return 'success'
  if (status === 'failure') return 'destructive'
  return 'warning'
}

export default function KeyDetail(snapshot: KeyWithRelations) {
  // The drawer opens with a point-in-time snapshot. Subscribe (read-only, no fetch via
  // skipToken) to the live keys cache so the panel reflects unstake/retire transitions
  // while it stays open instead of sticking on the pre-unstake state until reopened.
  // Falls back to the snapshot before the cache is populated (e.g. deep-link).
  const { data: keysData } = useQuery<{ keys: KeyWithRelations[] }>({
    queryKey: ['keys'],
    queryFn: skipToken,
  })
  // Instant in-flight signal, mirrors the keys-list badge override.
  const { data: pendingUnstakeAddresses } = useQuery<Set<string>>({
    queryKey: ['keys-pending-unstake'],
    queryFn: skipToken,
  })
  const key = keysData?.keys?.find((k) => k.address === snapshot.address) ?? snapshot

  // Transactions for this key — each row opens the existing TransactionDetail drawer
  // (stacked on top of this panel). Server actions serialize Date natively; no bigint on
  // provider transactions, so rows pass straight through as the drawer's body.
  const addItem = useAddItemToDetail()
  const { data: keyTransactions } = useQuery({
    queryKey: ['key-transactions', snapshot.address],
    queryFn: async () => {
      const r = await ListTransactionsByKey(snapshot.address)
      return r.success ? r.data : []
    },
  })

  const {
    id,
    address,
    ownerAddress,
    state,
    balanceUpokt,
    stakeAmountUpokt,
    stakeOwner,
    lastUpdatedHeight,
    deliveredAt,
    delegator,
    addressGroup,
    delegatorRevSharePercentage,
    delegatorRewardsAddress,
    remediationHistory,
    services,
    createdAt,
    exportedAt,
    exportCount,
    retiredAt,
  } = key;

  // Lifecycle status mirrors the keys list: Retired (retiredAt) wins outright, then a
  // fast "Unstaking…" while an unstake tx is in flight but state hasn't flipped yet.
  const isRetired = retiredAt != null
  const isPendingUnstake =
    !isRetired && state === KeyState.Staked && (pendingUnstakeAddresses?.has(address) ?? false)
  const lifecycleLabel = isPendingUnstake
    ? 'Unstaking…'
    : deriveKeyLifecycleStatus({ state, retiredAt })
  const statusBadgeClass = isPendingUnstake
    ? 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30'
    : isRetired
      ? 'bg-bg-elevated text-text-secondary border-border-primary'
      : (stateColor[state] || 'bg-bg-elevated text-text-secondary')

  const isStakedKey = [KeyState.Staked, KeyState.RemediationFailed, KeyState.AttentionNeeded, KeyState.Unstaked].includes(state);
  // Never offer unstake on a key that is already retired or has an unstake in flight.
  const isUnstakeable = !isRetired && !isPendingUnstake &&
    [KeyState.Staked, KeyState.RemediationFailed, KeyState.AttentionNeeded].includes(state);
  const description = isPendingUnstake
    ? 'This key is being unstaked from the network.'
    : isRetired
      ? 'This key has been retired and will not be reused.'
      : stateDescription[state]

  const generalKeyDetails: Array<SummaryRow> = [
    {
      label: 'Address',
      value: <Address address={address} />,
    },
    {
      label: 'State',
      value: (
        <span className={clsx('inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border', statusBadgeClass)}>
          {lifecycleLabel}
        </span>
      ),
    },
    addressGroup && {
      label: 'Address Group',
      value: <span>{addressGroup.name}</span>,
    },
    {
      label: 'Balance',
      value: <Amount value={amountToPokt(balanceUpokt?.toString() ?? 0)} />,
    },
    isStakedKey && {
      label: 'Stake Amount',
      value: <Amount value={amountToPokt(stakeAmountUpokt?.toString() ?? 0)} />,
    },
    (isStakedKey && stakeOwner && stakeOwner !== ownerAddress) && {
      label: 'Stake Owner',
      value: stakeOwner ? <Address address={stakeOwner} /> : 'N/A',
    },
    ownerAddress && {
      label: 'Owner',
      value: <Address address={ownerAddress} showAvatar />,
    },
    delegator && {
      label: 'Delivered To',
      value: <span>{delegator.name}</span>,
    },
    delegator && deliveredAt && {
      label: 'Delivered At',
      value: <span className="font-mono text-text-secondary">{new Date(deliveredAt).toLocaleString()}</span>,
    },
    createdAt && {
      label: 'Created',
      value: <span className="font-mono text-text-secondary">{new Date(createdAt).toLocaleString()}</span>,
    },
    isRetired && {
      label: 'Retired At',
      value: <span className="font-mono text-text-secondary">{new Date(retiredAt!).toLocaleString()}</span>,
    },
    {
      label: 'Last Updated Height',
      value: <span className="font-mono">{lastUpdatedHeight?.toLocaleString() || '—'}</span>,
    },
  ].filter(Boolean) as Array<SummaryRow>

  const delegatorRewardsDetails: Array<SummaryRow> = [
    {
      label: 'Rewards Address',
      value: (
        <div className={'gap-2 flex flex-row items-center'}>
          {delegatorRewardsAddress ? <Address address={delegatorRewardsAddress} /> : 'N/A'}
          <QuickInfoPopOverIcon
            title={'Delegator Rewards Address'}
            description={'The address where the stake intermediary receives their rewards share.'}
          />
        </div>
      ),
    },
    {
      label: 'Rev Share',
      value: (
        <div className={'gap-2 flex flex-row items-center'}>
          <span>{delegatorRevSharePercentage != null ? `${delegatorRevSharePercentage}%` : 'N/A'}</span>
          <QuickInfoPopOverIcon
            title={'Delegator Rev Share'}
            description={'The percentage the stake intermediary receives from each service.'}
          />
        </div>
      ),
    },
  ];

  const hasServices = services && services.length > 0
  const hasExportInfo = (exportCount ?? 0) > 0

  return (
    <div className={'gap-6 flex flex-col'}>
      <DrawerHeader className={'p-0 gap-1'}>
        <DrawerTitle className="text-2xl font-normal">Key</DrawerTitle>
        <DrawerDescription className={'text-sm'}>
          Supplier key details and on-chain status
        </DrawerDescription>
      </DrawerHeader>

      {isStakedKey && (
        <div
          className={
            clsx(
              'relative flex h-[64px] mt-[-5px]',
              (state === KeyState.Staked && !isPendingUnstake) && 'gradient-border-green',
              isPendingUnstake && 'gradient-border-orange',
              ([KeyState.Unstaked].includes(state)) && 'gradient-border-slate',
              ([KeyState.AttentionNeeded, KeyState.RemediationFailed].includes(state)) && 'gradient-border-orange',
            )
          }
        >
          <div className={`absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between`}>
            <span className="text-[20px] text-text-secondary">
              {isPendingUnstake ? 'Unstaking…' : (KeyStateNameMap[state] || state)}
            </span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">
                <Amount value={amountToPokt(stakeAmountUpokt?.toString() ?? 0)} />
              </p>
            </div>
          </div>
        </div>
      )}

      {description && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
            {description}
          </span>
        </div>
      )}

      <Summary rows={generalKeyDetails} />

      {addressGroup && (
        <MigrateKeyButton
          keyId={id}
          currentGroupId={addressGroup.id}
          currentGroupName={addressGroup.name}
        />
      )}

      {isUnstakeable && (
        <UnstakeKeyButton
          keyId={id}
          address={address}
          stakeAmountUpokt={stakeAmountUpokt}
          balanceUpokt={balanceUpokt}
        />
      )}

      {isStakedKey && delegator && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Delegator</span>
          <Summary rows={delegatorRewardsDetails} />
        </div>
      )}

      {hasServices && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Services</span>
          <div className="flex flex-col bg-bg-elevated rounded-[8px] divide-y divide-border-primary">
            {services!.map((svc: any, idx: number) => (
              <div key={idx} className="flex flex-row items-center justify-between p-[8px_12px] text-sm">
                <span>{svc.serviceId || svc.service?.id || `Service ${idx + 1}`}</span>
                {svc.revSharePercentage != null && (
                  <span className="text-text-tertiary text-xs">{svc.revSharePercentage}% rev share</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasExportInfo && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Export History</span>
          <div className="flex flex-col bg-bg-elevated rounded-[8px] p-[8px_12px] text-sm text-text-secondary gap-1">
            <div className="flex justify-between">
              <span>Times exported</span>
              <span className="font-mono">{exportCount}</span>
            </div>
            {exportedAt && (
              <div className="flex justify-between">
                <span>Last exported</span>
                <span className="font-mono">{new Date(exportedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(remediationHistory?.length ?? 0) > 0 && (
        <RemediationHistoryList
          entries={remediationHistory ?? []}
          keyState={state}
          keyId={id}
        />
      )}

      {(keyTransactions?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Transactions</span>
          <div className="flex flex-col bg-bg-elevated rounded-[8px] divide-y divide-border-primary">
            {keyTransactions!.map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => addItem({ type: 'transaction', body: tx })}
                className="flex flex-row items-center justify-between p-[8px_12px] text-sm hover:bg-bg-hover text-left transition-colors"
              >
                <span className="flex flex-col gap-0.5">
                  <span>{TX_TYPE_LABELS[tx.type] || tx.type}</span>
                  {tx.createdAt && (
                    <span className="text-xs text-text-tertiary font-mono">
                      {new Date(tx.createdAt).toLocaleString()}
                    </span>
                  )}
                </span>
                <Badge variant={txStatusVariant(tx.status)}>{tx.status}</Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      <PrivateKeyReveal keyId={id} />
    </div>
  )
}
