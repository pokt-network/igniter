'use client';

import { NodeStatus, SupplierChangeType } from '@igniter/db/middleman/enums'
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
import {useAddItemToDetail} from '@igniter/ui/components/QuickDetails/Provider'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { NodeService, Provider } from '@igniter/db/middleman/schema'
import {TransactionDetailBody} from "@/app/detail/TransactionDetail"
import { UnstakeProcess } from '@/app/app/unstake/components/UnstakeProcess'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GetUnstakeDuration } from '@/actions/Unstake'
import { GetSupplierChanges, AcknowledgeAllByNode } from '@/actions/SupplierChanges'
import { formatDuration } from '@/lib/utils/time'
import { GetNode } from '@/actions/Nodes'
import { Skeleton } from '@igniter/ui/components/skeleton'

export interface NodeDetailBody {
  [key: string]: unknown;
  id: number
  address: string;
  ownerAddress: string;
  status: NodeStatus;
  provider: Provider | null;
  stakeAmount: number;
  operationalFundsAmount: number;
  transactions?: Array<TransactionDetailBody>;
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
    <div className="rounded-[8px] border border-border-primary p-3 flex flex-col gap-3">
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
          <span className="text-xs text-text-tertiary">
            Client Share: <span className="font-mono text-text-primary">{clientShare.toFixed(1)}%</span>
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
                  <span className="font-mono text-xs truncate text-text-tertiary">{ep.url}</span>
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
                  <span className={`font-mono text-xs ${rs.address.toLowerCase() === ownerAddress.toLowerCase() ? 'text-text-primary font-bold' : 'text-text-tertiary'}`}>
                    {getShortAddress(rs.address, 5)}
                  </span>
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

const CHANGE_TYPE_ICON: Record<string, string> = {
  [SupplierChangeType.ServiceAdded]: '+',
  [SupplierChangeType.ServiceRemoved]: '-',
  [SupplierChangeType.RevShareChanged]: '~',
}

const CHANGE_TYPE_COLOR: Record<string, string> = {
  [SupplierChangeType.ServiceAdded]: 'text-green-400',
  [SupplierChangeType.ServiceRemoved]: 'text-red-400',
  [SupplierChangeType.RevShareChanged]: 'text-yellow-400',
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function RecentChanges({ nodeId }: { nodeId: number }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isAcknowledging, setIsAcknowledging] = useState(false)
  const queryClient = useQueryClient()

  const { data: changes } = useQuery({
    queryKey: ['supplier-changes', nodeId],
    queryFn: () => GetSupplierChanges(nodeId),
  })

  if (!changes?.length) return null

  const unreadCount = changes.filter((c) => !c.acknowledgedAt).length

  const handleAcknowledgeAll = async () => {
    setIsAcknowledging(true)
    try {
      await AcknowledgeAllByNode(nodeId)
      await queryClient.invalidateQueries({ queryKey: ['supplier-changes', nodeId] })
      await queryClient.invalidateQueries({ queryKey: ['unacknowledged-supplier-changes'] })
    } finally {
      setIsAcknowledging(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-2 cursor-pointer w-fit"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <span className="flex items-center justify-center">
            <CaretSmallIcon
              style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
            />
          </span>
          <span className="text-sm">
            Recent Changes ({changes.length})
          </span>
          {unreadCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
          )}
        </span>

        {unreadCount > 0 && isExpanded && (
          <Button
            variant="ghost"
            className="text-xs h-6 px-2"
            disabled={isAcknowledging}
            onClick={handleAcknowledgeAll}
          >
            Mark all as read
          </Button>
        )}
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-2">
          {changes.map((change) => (
            <div
              key={change.id}
              className={clsx(
                'rounded-[8px] border border-border-primary px-3 py-2 flex items-start gap-2',
                !change.acknowledgedAt && 'bg-bg-surface',
              )}
            >
              <span className={clsx('font-mono font-bold text-sm w-4 shrink-0', CHANGE_TYPE_COLOR[change.changeType])}>
                {CHANGE_TYPE_ICON[change.changeType] ?? '?'}
              </span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <p className="text-xs text-text-primary">{change.description}</p>
                <p className="text-xs text-text-tertiary">
                  {change.createdAt ? formatRelativeTime(new Date(change.createdAt)) : ''}
                </p>
              </div>
              {!change.acknowledgedAt && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0 mt-1.5" />
              )}
            </div>
          ))}
        </div>
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
          'w-full h-[30px] bg-bg-elevated border border-border-primary hover:bg-transparent',
          props.className,
        )
      }
    >
      {children}
    </Button>
  )
}

export default function NodeDetail({
   id,
   address,
   ownerAddress,
   status,
   provider,
   operationalFundsAmount,
   stakeAmount,
   transactions: transactionsFromProps,
   services,
}: NodeDetailBody) {
  const addItem = useAddItemToDetail()
  const [unstakeOpen, setUnstakeOpen] = useState(false);
  const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState(false);
  const [isShowingServices, setIsShowingServices] = useState(false);

  const {
    data: unstakeDurationData,
  } = useQuery({
    queryKey: ['unstake-duration'],
    queryFn: GetUnstakeDuration,
    enabled: status === NodeStatus.Staked,
  });
  
  const { data: nodeData, isLoading: isLoadingTransactions } = useQuery({
    queryKey: ['node-transactions', address],
    queryFn: () => GetNode(address),
    enabled: !transactionsFromProps?.length,
  });

  const transactions: TransactionDetailBody[] = transactionsFromProps ?? (nodeData?.transactionsToNodes ?? []).map((t) => ({
    id: t.transaction.id,
    type: t.transaction.type,
    status: t.transaction.status,
    createdAt: t.transaction.createdAt!,
    operations: JSON.parse(t.transaction.unsignedPayload).body.messages,
    hash: t.transaction.hash || '',
    estimatedFee: t.transaction.estimatedFee,
    consumedFee: t.transaction.consumedFee,
    provider: provider?.name || '',
    providerFee: t.transaction.providerFee,
    typeProviderFee: t.transaction.typeProviderFee,
  }));

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

  if (isLoadingTransactions) {
    summaryRows.push({
      label: <Skeleton className="w-24 h-4 bg-bg-elevated" />,
      value: null,
    })
  } else if (transactions.length) {
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
          <span className="text-[20px] text-white">
            {status.slice(0, 1).toUpperCase() + status.slice(1)}
          </span>
          <div className="flex flex-row items-center gap-2">
            <p className="font-mono !text-[20px] text-white">
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
            <div className="rounded-[8px] bg-bg-surface px-4 py-3">
              <p className="text-sm text-text-tertiary">
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
                <p className="text-sm text-text-tertiary">
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
                    <div key={height} className="rounded-[8px] bg-bg-surface px-4 py-3 flex flex-col gap-2">
                      <p className="text-xs text-text-tertiary">
                        {svcs.length} service{svcs.length > 1 ? 's' : ''} scheduled to activate at block{' '}
                        <span className="font-mono text-text-primary">{height}</span>
                        . Not yet visible on-chain — won&apos;t appear in blockchain explorers until that block is reached.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {svcs.map((s) => (
                          <Badge key={s.serviceId} variant="outline" className="font-mono text-text-tertiary">
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

      <RecentChanges nodeId={id} />

      {status === NodeStatus.Staked && (
        <div className={'bg-bg-surface h-[109px] rounded-[8px]'}>
          <p className={'px-4 py-[11px] text-text-tertiary'}>
            Recoup your tokens by unstaking this supplier. Process can take up to{' '}
            {unstakeDurationData ? (
              <span className="font-mono text-text-primary">{formatDuration(unstakeDurationData.durationSeconds)}</span>
            ) : (
              '...'
            )}. Tokens will be withdrawn to your wallet.
          </p>
          <hr className={'border-border-primary'} />
          <div className={'flex flex-row items-center gap-2 p-2'}>
            <ActionButton onClick={() => setUnstakeOpen(true)}>
              Unstake
            </ActionButton>
            <QuickInfoPopOverIcon
              title={'Unstake'}
              description={'Unstake this supplier. If the provider returns funds, the remaining balance goes to the owner.'}
            />
          </div>
          <UnstakeProcess
            open={unstakeOpen}
            onOpenChange={setUnstakeOpen}
            preselectedAddresses={[address]}
          />
        </div>
      )}
    </div>
  )
}
