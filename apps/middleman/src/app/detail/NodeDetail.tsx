'use client';

import { NodeStatus } from '@igniter/db/middleman/enums'
import Amount from '@igniter/ui/components/Amount'
import React, { useState } from 'react'
import { Badge } from '@igniter/ui/components/badge'
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
import { NodeService, Provider } from '@igniter/db/middleman/schema'
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
  services: NodeService[];
}

export interface NodeDetail {
  type: 'node'
  body: NodeDetailBody
}


const RPC_TYPE_LABELS: Record<number, string> = {
  1: 'gRPC',
  2: 'WebSocket',
  3: 'JSON-RPC',
  4: 'REST',
  5: 'CometBFT',
}

function ServiceCard({ service, ownerAddress }: { service: NodeService; ownerAddress: string }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const ownerRevShare = service.revShare.find(
    (rs) => rs.address.toLowerCase() === ownerAddress.toLowerCase()
  )
  const clientShare = ownerRevShare?.revSharePercentage ?? null
  const hasDetails = service.endpoints.length > 0 || service.revShare.length > 0

  return (
    <div className="rounded-[8px] border border-[color:var(--divider)] p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasDetails && (
            <span
              className="flex items-center justify-center cursor-pointer shrink-0"
              onClick={() => setIsExpanded(prev => !prev)}
            >
              <CaretSmallIcon style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }} />
            </span>
          )}
          <Badge variant="outline" className="font-mono">
            {service.serviceId}
          </Badge>
        </div>
        {clientShare !== null && (
          <span className="text-xs text-[color:var(--color-white-3)]">
            Client Share: <span className="font-mono text-[color:var(--color-white-1)]">{clientShare.toFixed(1)}%</span>
          </span>
        )}
      </div>

      {isExpanded && (
        <>
          {service.endpoints.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-[color:var(--muted-foreground)]">Endpoints</p>
              {service.endpoints.map((ep, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs truncate text-[color:var(--color-white-3)]">{ep.url}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{RPC_TYPE_LABELS[ep.rpcType] ?? 'Unknown'}</Badge>
                </div>
              ))}
            </div>
          )}

          {service.revShare.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-[color:var(--muted-foreground)]">Revenue Share</p>
              {service.revShare.map((rs, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-[color:var(--color-white-3)]">{getShortAddress(rs.address, 5)}</span>
                  <span className="font-mono text-xs">{rs.revSharePercentage}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
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
   stakeAmount,
   services,
}: NodeDetailBody) {
  const addItem = useAddItemToDetail()
  const removeLastItem = useRemoveLastItemFromDetail()
  const router = useRouter()
  const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState(false);
  const [isShowingServices, setIsShowingServices] = useState(false);

  const {
    data: unstakeDurationData,
  } = useQuery({
    queryKey: ['unstake-duration'],
    queryFn: GetUnstakeDuration,
    enabled: status === NodeStatus.Staked,
  });

  const summaryRows: Array<SummaryRow> = [
    {
      label: `Supplier`,
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
          Supplier Detail
        </DrawerTitle>
        <DrawerDescription className={'text-sm'}>
          Review the details of your supplier.
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

      {(() => {
        const activeServices = (services ?? []).filter(s => !s.pendingActivationHeight)
        const pendingServices = (services ?? []).filter(s => !!s.pendingActivationHeight)

        if (activeServices.length === 0 && pendingServices.length === 0) {
          return (
            <div className="rounded-[8px] bg-[color:var(--color-slate-2)] px-4 py-3">
              <p className="text-sm text-[color:var(--color-white-3)]">
                No services yet. The provider will configure services once they process your stake.
              </p>
            </div>
          )
        }

        return (
          <div className="flex flex-col gap-3">
            {activeServices.length > 0 && (
              <>
                <span
                  className="flex items-center gap-2 cursor-pointer w-fit"
                  onClick={() => setIsShowingServices(prev => !prev)}
                >
                  <span className="flex items-center justify-center">
                    <CaretSmallIcon
                      style={{ transform: isShowingServices ? 'rotate(90deg)' : undefined }}
                    />
                  </span>
                  <span className="text-sm">Services ({activeServices.length})</span>
                </span>

                {isShowingServices && (
                  <div className="flex flex-col gap-3">
                    {activeServices.map((service) => (
                      <ServiceCard key={service.serviceId} service={service} ownerAddress={ownerAddress} />
                    ))}
                  </div>
                )}
              </>
            )}

            {pendingServices.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-[color:var(--color-white-3)]">
                  Services pending activation
                </p>
                {Object.entries(
                  pendingServices.reduce<Record<number, typeof pendingServices>>((groups, s) => {
                    const h = s.pendingActivationHeight!
                    ;(groups[h] ??= []).push(s)
                    return groups
                  }, {})
                )
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([height, svcs]) => (
                    <div key={height} className="rounded-[8px] bg-[color:var(--color-slate-2)] px-4 py-3 flex flex-col gap-2">
                      <p className="text-xs text-[color:var(--color-white-3)]">
                        {svcs.length} service{svcs.length > 1 ? 's' : ''} scheduled to activate at block{' '}
                        <span className="font-mono text-[color:var(--color-white-1)]">{height}</span>
                        . Not yet visible on-chain — won&apos;t appear in blockchain explorers until that block is reached.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {svcs.map((s) => (
                          <Badge key={s.serviceId} variant="outline" className="font-mono text-[color:var(--color-white-3)]">
                            {s.serviceId}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )
      })()}

      {status === NodeStatus.Staked && (
        <div className={'bg-[color:var(--color-slate-2)] h-[109px] rounded-[8px]'}>
          <p className={'px-4 py-[11px] text-[color:var(--color-white-3)]'}>
            Recoup your tokens by unstaking this supplier. Process can take up to{' '}
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
