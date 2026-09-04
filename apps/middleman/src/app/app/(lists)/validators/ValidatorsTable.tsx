'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import Address from '@igniter/ui/components/Address'
import Amount from '@igniter/ui/components/Amount'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { amountToPokt } from '@igniter/ui/lib/utils'
import { GetValidators } from '@/actions/Staking'
import type { ValidatorSummary } from '@/lib/staking/parse'
import { buildDelegateMessage } from '@/lib/staking/messages'
import { StakingActionDialog } from './StakingActionDialog'
import { toast } from 'sonner'

const columns: (ColumnDef<ValidatorSummary> & CsvColumnDef<ValidatorSummary>)[] = [
  {
    accessorKey: 'moniker',
    header: 'Validator',
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.moniker}</span>
        <Address address={row.original.operatorAddress} />
      </div>
    ),
  },
  {
    accessorKey: 'tokens',
    header: 'Voting Power',
    cell: ({ row }) => <Amount value={amountToPokt(row.original.tokens)} maxFractionDigits={0} minimumFractionDigits={0} />,
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
      <span className={row.original.jailed ? 'text-red-500' : row.original.status === 'bonded' ? 'text-green-500' : 'text-text-secondary'}>
        {row.original.jailed ? 'Jailed' : row.original.status}
      </span>
    ),
  },
]

export default function ValidatorsTable() {
  const { connectedIdentity, getBalance } = useWalletConnection()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<ValidatorSummary | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['validators'],
    queryFn: GetValidators,
    refetchInterval: 60_000,
  })

  const { data: balance } = useQuery({
    queryKey: ['balance', connectedIdentity],
    queryFn: () => getBalance(connectedIdentity!),
    enabled: Boolean(connectedIdentity) && Boolean(target),
  })

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
        itemActions={(v) => (
          <Button
            size="sm"
            disabled={!connectedIdentity || v.jailed || v.status !== 'bonded'}
            onClick={() => setTarget(v)}
          >
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
