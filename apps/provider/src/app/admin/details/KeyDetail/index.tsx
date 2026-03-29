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

export interface KeyDetail {
  type: 'key'
  body: KeyWithRelations
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
    delegatorRevSharePercentage,
    delegatorRewardsAddress,
    remediationHistory,
  } = key;

  const isStakedKey = [KeyState.Staked, KeyState.RemediationFailed, KeyState.AttentionNeeded, KeyState.Unstaked].includes(state);

  const generalKeyDetails: Array<SummaryRow> = [
    {
      label: 'Address',
      value: <Address address={address} />,
    },
    {
      label: 'Balance',
      value: <Amount value={amountToPokt(balanceUpokt?.toString() ?? 0)} />,
    },
    (isStakedKey && stakeOwner && stakeOwner !== ownerAddress) && {
      label: 'Stake Owner',
      value: stakeOwner ? <Address address={stakeOwner ?? ''} /> : 'N/A',
    },
    isStakedKey && {
      label: 'Owner',
      value: ownerAddress ? <Address address={ownerAddress} showAvatar /> : 'N/A',
    },
    delegator && {
      label: 'Delivered To',
      value: <span>{delegator.name}</span>,
    },
    delegator && {
      label: 'Delivered At',
      value: <span>{deliveredAt?.toISOString() ?? ''}</span>,
    },
    {
      label: 'Last Updated Height',
      value: <span>{lastUpdatedHeight}</span>,
    },
  ].filter(Boolean) as Array<SummaryRow>

  const delegatorRewardsDetails: Array<SummaryRow> = [
    {
      label: 'Delegator Rewards Address',
      value: (
        <div className={'gap-2 flex flex-row items-center'}>
          {delegatorRewardsAddress ? <Address address={delegatorRewardsAddress ?? ''} /> : 'N/A'}
          <QuickInfoPopOverIcon
            title={'Delegator Rewards Address'}
            description={'This is the address the stake intermediary expects to receive their rewards share. This information is gathered automatically. But keys created before igniter 0.3 might need to be manually updated.'}
          />
        </div>
      ),
    },
    {
      label: 'Delegator Rev Share',
      value: (
        <div className={'gap-2 flex flex-row items-center'}>
          <span>{delegatorRevSharePercentage ?? 'N/A'}</span>
          <QuickInfoPopOverIcon
            title={'Delegator Rev Share'}
            description={'The revShare percentage the stake intermediary expects to receive from each service.'}
          />
        </div>
      ),
    },
  ];

  return (
    <div className={'gap-8 flex flex-col'}>
      <DrawerHeader className={'p-0 gap-2'}>
        <DrawerTitle
          style={{
            fontSize: '1.875rem',
            fontWeight: 400,
          }}
        >
          Key
        </DrawerTitle>
        <DrawerDescription className={'text-sm'}>
          Details of a managed supplier address
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

      {!isStakedKey && (state === KeyState.Available) && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
             This key is readily <strong>available</strong> to be staked. When a request for suppliers is received this key is prioritized. It's a recommended practice to pre-configure these keys in their corresponding relay miner.
          </span>
        </div>
      )}

      {!isStakedKey && (state === KeyState.Imported) && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
             This key has recently been <strong>imported</strong>. The system will eventually evaluate it in the network and set it to its corresponding state, either <strong>available</strong>, <strong>staked</strong> or <strong>unstaked</strong>.
          </span>
        </div>
      )}

      {!isStakedKey && (state === KeyState.MissingStake) && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
             This key was delivered for staking over 24h ago, but we could not find a corresponding stake in the network.
          </span>
        </div>
      )}

      {state === KeyState.Staked && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
             This key is <strong>{KeyStateNameMap[state]}</strong>. The system has not detected any issues.
          </span>
        </div>
      )}

      {[KeyState.RemediationFailed, KeyState.AttentionNeeded].includes(state) && (
        <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
          <span className="text-[14px] text-text-secondary p-[11px_16px]">
             This key is <strong>{KeyStateNameMap[state]}</strong>. The system has detected issues with the key. This doesn't mean the supplier is not operational. Please review the details below.
          </span>
        </div>
      )}

      <Summary
        rows={generalKeyDetails}
      />

      {isStakedKey && (
        <Summary
          rows={delegatorRewardsDetails}
        />
      )}

      {(remediationHistory?.length ?? 0) > 0 && (
        <RemediationHistoryList
          entries={remediationHistory ?? []}
          keyState={state}
          keyId={id}
        />
      )}
    </div>
  )
}
