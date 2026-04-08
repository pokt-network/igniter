'use client';

import Amount from '@igniter/ui/components/Amount'
import React from 'react'
import { clsx } from 'clsx'
import { DrawerDescription, DrawerHeader, DrawerTitle } from '@igniter/ui/components/drawer'
import Summary, { SummaryRow } from '@igniter/ui/components/Summary'
import { amountToPokt } from '@igniter/ui/lib/utils'
import Address from '@igniter/ui/components/Address'
import {KeyWithRelations} from "@igniter/db/provider/schema"
import {KeyState, KeyStateNameMap} from "@igniter/db/provider/enums"
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import {RemediationHistoryList} from "@/app/admin/details/KeyDetail/RemediationHistoryList";
import {KeyStateLabels} from "@/app/admin/(internal)/keys/constants";
import PrivateKeyReveal from "@/app/admin/details/KeyDetail/PrivateKeyReveal"
import { MigrateKeyButton } from "@/app/admin/details/KeyDetail/MigrateKeyButton";

export interface KeyDetail {
  type: 'key'
  body: KeyWithRelations
}

const stateColor: Record<string, string> = {
  [KeyState.Available]: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  [KeyState.Delivered]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.Staking]: 'bg-pnf-gold/15 text-pnf-gold border-pnf-gold/30',
  [KeyState.Staked]: 'bg-success/15 text-success border-success/30',
  [KeyState.StakingFailed]: 'bg-error/15 text-error border-error/30',
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

export default function KeyDetail(key: KeyWithRelations) {
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
  } = key;

  const isStakedKey = [KeyState.Staked, KeyState.RemediationFailed, KeyState.AttentionNeeded, KeyState.Unstaked].includes(state);
  const description = stateDescription[state]

  const generalKeyDetails: Array<SummaryRow> = [
    {
      label: 'Address',
      value: <Address address={address} />,
    },
    {
      label: 'State',
      value: (
        <span className={clsx('inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border', stateColor[state] || 'bg-bg-elevated text-text-secondary')}>
          {KeyStateLabels[state] || state}
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
              (state === KeyState.Staked) && 'gradient-border-green',
              ([KeyState.Unstaked].includes(state)) && 'gradient-border-slate',
              ([KeyState.AttentionNeeded, KeyState.RemediationFailed].includes(state)) && 'gradient-border-orange',
            )
          }
        >
          <div className={`absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between`}>
            <span className="text-[20px] text-text-secondary">
              {KeyStateNameMap[KeyState.Staked]}
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

      <PrivateKeyReveal keyId={id} />
    </div>
  )
}
