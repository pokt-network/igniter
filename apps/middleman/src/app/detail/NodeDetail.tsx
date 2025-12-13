'use client';

import { NodeStatus } from '@igniter/db/middleman/enums'
import Amount from '@igniter/ui/components/Amount'
import React, { useState } from 'react'
import { clsx } from 'clsx'
import { DrawerDescription, DrawerHeader, DrawerTitle } from '@igniter/ui/components/drawer'
import { Button, ButtonProps } from '@igniter/ui/components/button'
import Summary, { SummaryRow } from '@igniter/ui/components/Summary'
import { amountToPokt, getShortAddress } from '@igniter/ui/lib/utils'
import Address from '@igniter/ui/components/Address'
import { CaretSmallIcon } from '@igniter/ui/assets'
import {useAddItemToDetail, useRemoveLastItemFromDetail} from '@igniter/ui/components/QuickDetails/Provider'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { Provider } from '@igniter/db/middleman/schema'
import {TransactionDetailBody} from "@/app/detail/TransactionDetail"
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { GetUnstakeDuration } from '@/actions/Unstake'
import { formatDuration } from '@/lib/utils/time'

export interface NodeDetailBody {
  [key: string]: unknown;
  id: number
  address: string;
  ownerAddress: string;
  status: NodeStatus;
  provider: Provider | null;
  stakeAmount: number;
  operationalFundsAmount: number;
  transactions: Array<TransactionDetailBody>;
}

export interface NodeDetail {
  type: 'node'
  body: NodeDetailBody
}


function ActionButton({children, ...props}: React.PropsWithChildren & Omit<ButtonProps, 'children'>) {
  return (
    <Button
      {...props}
      className={
        clsx(
          'w-full h-[30px] bg-[color:var(--secondary)] border border-[color:var(--button-2-border)] hover:bg-transparent',
          props.className,
        )
      }
    >
      {children}
    </Button>
  )
}

export default function NodeDetail({
   address,
   ownerAddress,
   status,
   transactions,
   provider,
   operationalFundsAmount,
   stakeAmount
}: NodeDetailBody) {
  const addItem = useAddItemToDetail()
  const removeLastItem = useRemoveLastItemFromDetail()
  const router = useRouter()
  const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState(false);

  const {
    data: unstakeDurationData,
  } = useQuery({
    queryKey: ['unstake-duration'],
    queryFn: GetUnstakeDuration,
    enabled: status === NodeStatus.Staked,
  });

  const summaryRows: Array<SummaryRow> = [
    {
      label: `Node`,
      value: <Address address={address} />,
    },
    {
      label: 'Owner',
      value: (
        <div className={'flex items-center gap-2'}>
          <AvatarByString string={ownerAddress} />
          <span className={'font-mono text-sm'}>
            {getShortAddress(ownerAddress, 5)}
          </span>
        </div>
      )
    },
    {
      label: 'Provider',
      value: provider?.name ?? 'N/A',
    },
    {
      label: 'Operational Funds',
      value: (
        <p className={'text-sm'}>
          <Amount value={amountToPokt(operationalFundsAmount)} />
        </p>
      )
    }
  ]

  if (transactions.length) {
    summaryRows.push({
      label: (
        <div className={'flex items-center gap-2'}>
          <Button
            variant={'ghost'}
            className={'p-0 h-6 !items-center border-none mb-[-4px] hover:bg-transparent w-full'}
            onClick={() => setIsShowingTransactionDetails(prev => !prev)}
          >
            <CaretSmallIcon
              style={{
                transform: isShowingTransactionDetails ? 'rotate(90deg)' : undefined,
                marginRight: isShowingTransactionDetails ? 0 : '-6px',
                marginLeft: isShowingTransactionDetails ? '-6px' : 0,
                marginBottom: '-6px'
              }}
            />
            <span>Transactions ({transactions.length})</span>
          </Button>
        </div>
      ),
      value: null
    })

    if (isShowingTransactionDetails) {
      for (const transaction of transactions) {
        summaryRows.push({
          label: (
            <p
              className={'text-[color:var(--muted-foreground)] h-6 mb-[-4px] hover:bg-transparent'}
            >
              {transaction.type}
            </p>
          ),
          value: (
            <TransactionHash
              hash={transaction.hash}
              onClick={() => {
                addItem({
                  type: 'transaction',
                  body: transaction
                })
              }}
            />
          )
        })
      }
    }
  }

  return (
    <div className={'gap-8 flex flex-col'}>
      <DrawerHeader className={'p-0 gap-2'}>
        <DrawerTitle
          style={{
            fontSize: '1.875rem',
            fontWeight: 400,
          }}
        >
          Node Detail
        </DrawerTitle>
        <DrawerDescription className={'text-sm'}>
          Review the details of your node.
        </DrawerDescription>
      </DrawerHeader>
      <div
        className={
          clsx(
            'relative flex h-[64px] mt-[-5px]',
            (status === NodeStatus.Staked && operationalFundsAmount) && 'gradient-border-slate',
            status === NodeStatus.Unstaking && 'gradient-border-purple',
            ((status === NodeStatus.Staked && !operationalFundsAmount) || status === NodeStatus.Unstaked) && 'gradient-border-orange',
          )
        }
      >
        <div className={`absolute inset-0 flex flex-row items-center bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
          <span className="text-[20px] text-[var(--color-white-3)]">
            {status.slice(0, 1).toUpperCase() + status.slice(1)}
          </span>
          <div className="flex flex-row items-center gap-2">
            <p className="font-mono !text-[20px]">
              <Amount value={amountToPokt(stakeAmount)} />
            </p>
          </div>
        </div>
      </div>

      <Summary
        rows={summaryRows}
      />

      {status === NodeStatus.Staked && (
        <div className={'bg-[color:var(--color-slate-2)] h-[109px] rounded-[8px]'}>
          <p className={'px-4 py-[11px] text-[color:var(--color-white-3)]'}>
            Recoup your tokens by unstaking this node. Process can take up to{' '}
            {unstakeDurationData ? (
              <span className="font-mono text-[var(--color-white-1)]">{formatDuration(unstakeDurationData.durationSeconds)}</span>
            ) : (
              '...'
            )}. Tokens will be withdrawn to your wallet.
          </p>
          <hr className={'border-[color:var(--divider)]'} />
          <div className={'flex flex-row items-center gap-2 p-2'}>
            <ActionButton
              onClick={() => {
                removeLastItem()
                router.push('/app/unstake')
              }}
            >
              Unstake
            </ActionButton>
            <QuickInfoPopOverIcon
              title={'Unstake'}
              description={'Navigate to the unstake page to unstake this node.'}
            />
          </div>
        </div>
      )}
    </div>
  )
}
