'use client'

import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import Address from '@igniter/ui/components/Address'
import Amount from '@igniter/ui/components/Amount'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { useApplicationSettings } from '@/app/context/ApplicationSettings'
import { amountToPokt } from '@igniter/ui/lib/utils'
import { GetValidatorApr, GetValidators } from '@/actions/Staking'
import type { ValidatorSummary } from '@/lib/staking/parse'
import { APR_WINDOWS, type AprSnapshot, type AprWindow } from '@/lib/staking/apr'
import { buildDelegateMessage } from '@/lib/staking/messages'
import { explorerValidatorUrl } from '@/lib/staking/explorer'
import { StakingActionDialog } from './StakingActionDialog'
import { toast } from 'sonner'

function baseColumns(chainId: string | undefined): (ColumnDef<ValidatorSummary> & CsvColumnDef<ValidatorSummary>)[] {
  return [
    {
      accessorKey: 'moniker',
      header: 'Validator',
      cell: ({ row }) => {
        const url = explorerValidatorUrl(chainId, row.original.operatorAddress)
        return (
          <div className="flex flex-col">
            {url ? (
              <a
                className="font-medium hover:underline underline-offset-4"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {row.original.moniker}
              </a>
            ) : (
              <span className="font-medium">{row.original.moniker}</span>
            )}
            <Address address={row.original.operatorAddress} />
          </div>
        )
      },
    },
    {
      accessorKey: 'tokens',
      header: 'Voting Power',
      cell: ({ row }) => (
        <Amount value={amountToPokt(row.original.tokens)} maxFractionDigits={0} minimumFractionDigits={0} />
      ),
    },
    {
      accessorKey: 'commissionRate',
      header: 'Commission',
      cell: ({ row }) => <span className="font-mono">{(row.original.commissionRate * 100).toFixed(2)}%</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span
          className={
            row.original.jailed
              ? 'text-red-500'
              : row.original.status === 'bonded'
                ? 'text-green-500'
                : 'text-text-secondary'
          }
        >
          {row.original.jailed ? 'Jailed' : row.original.status}
        </span>
      ),
    },
  ]
}

function aprColumn(
  apr: AprSnapshot,
  window: AprWindow,
): ColumnDef<ValidatorSummary> & CsvColumnDef<ValidatorSummary> {
  return {
    id: 'apr',
    header: `APR ${window}d`,
    cell: ({ row }) => {
      const entry = apr.byValidator[row.original.operatorAddress]?.[window]
      if (!entry) return <span className="text-text-tertiary">—</span>
      return (
        <span className="font-mono" title={entry.fullWindow ? undefined : 'Less history than the selected window'}>
          {entry.delegatorAprPct.toFixed(2)}%{!entry.fullWindow && <span className="text-text-tertiary"> *</span>}
        </span>
      )
    },
  }
}

export default function ValidatorsTable() {
  const { connectedIdentity, getBalance } = useWalletConnection()
  const settings = useApplicationSettings()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<ValidatorSummary | null>(null)
  const [aprWindow, setAprWindow] = useState<AprWindow>(30)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['validators'],
    queryFn: GetValidators,
    refetchInterval: 60_000,
  })

  // Null on any non-mainnet chain or when the APR source is down: the column is
  // then dropped rather than rendered full of dashes.
  const { data: apr } = useQuery({
    queryKey: ['validator-apr'],
    queryFn: GetValidatorApr,
    staleTime: 10 * 60_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['balance', connectedIdentity],
    queryFn: () => getBalance(connectedIdentity!),
    enabled: Boolean(connectedIdentity) && Boolean(target),
  })

  const columns = useMemo(
    () =>
      apr ? [...baseColumns(settings?.chainId), aprColumn(apr, aprWindow)] : baseColumns(settings?.chainId),
    [apr, aprWindow, settings?.chainId],
  )

  const median = apr?.networkMedianPct[aprWindow]

  return (
    <>
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        isError={isError}
        refetch={refetch}
        searchableColumns={['moniker', 'operatorAddress']}
        searchPlaceholder="Search by moniker or address..."
        countLabel="validators"
        headerLeft={
          apr ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {APR_WINDOWS.map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    variant={w === aprWindow ? 'secondary' : 'ghost'}
                    onClick={() => setAprWindow(w)}
                  >
                    {w}d
                  </Button>
                ))}
              </div>
              {median !== undefined && (
                <span className="text-xs text-text-tertiary">Network median {median.toFixed(2)}%</span>
              )}
            </div>
          ) : undefined
        }
        itemActions={(v) => (
          <Button size="sm" disabled={!connectedIdentity || v.jailed || v.status !== 'bonded'} onClick={() => setTarget(v)}>
            Delegate
          </Button>
        )}
      />
      {target && connectedIdentity && (
        <StakingActionDialog
          open
          onClose={() => setTarget(null)}
          title={`Delegate to ${target.moniker}`}
          description={<Address address={target.operatorAddress} full />}
          signer={connectedIdentity}
          amount={{
            label: 'Amount (POKT)',
            maxUpokt: balance !== undefined ? Math.floor(balance * 1e6).toString() : undefined,
          }}
          buildMessages={(upokt) => [buildDelegateMessage(connectedIdentity, target.operatorAddress, upokt!)]}
          onSuccess={() => {
            toast.success('Delegation confirmed')
            queryClient.invalidateQueries({ queryKey: ['delegator-state', connectedIdentity] })
            queryClient.invalidateQueries({ queryKey: ['balance', connectedIdentity] })
            queryClient.invalidateQueries({ queryKey: ['validators'] })
          }}
        />
      )}
    </>
  )
}
