'use client'

import DataTable from '@igniter/ui/components/DataTable/index'
import { FilterGroup } from '@igniter/ui/components/DataTable/index'
import { columns, NodeDetails, sorts } from './columns'
import { GetUserNodes } from '@/actions/Nodes'
import { useQuery } from '@tanstack/react-query'
import {ItemBase, useDetailContext} from '@igniter/ui/components/QuickDetails/Provider'
import { useEffect, useMemo } from 'react'

export default function NodesTable() {
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: ["nodes"],
    queryFn: GetUserNodes,
    refetchInterval: 60000,
  });
  const {items, updateItem} = useDetailContext()

  useEffect(() => {
    const updateDetailItem = (item: ItemBase, index: number) => {
      if (item.type === 'node') {
        const node = data?.find((n) => n.id === item.body.id)

        if (node) {
          updateItem({
            type: "node",
            body: {
              id: node.id,
              address: node.address,
              ownerAddress: node.ownerAddress,
              status:  node.status,
              provider: node.provider || null,
              stakeAmount: Number(node.stakeAmount),
              operationalFundsAmount: Number(node.balance.toString()),
              services: node.services ?? [],
            }
          }, index)
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!

      // in theory, this promise is already awaited because when we push a new item,
      // it shows to the user so if it was a promise, it will be awaited
      if ('then' in item) {
        item.then((awaitedItem) => updateDetailItem(awaitedItem, i))
      } else {
        updateDetailItem(item, i)
      }
    }
  }, [data])

  const nodes: Array<NodeDetails> = data?.map((node) => {
    return {
      ...node,
      provider: node.provider ?? null,
      stakeAmount: node.stakeAmount,
      height: node.lastUpdatedHeight ?? 0,
    }
  }) || [];

  const filters = useMemo((): FilterGroup<NodeDetails>[] => {
    const uniqueProviders = Array.from(
      new Map(
        nodes
          .filter((n) => n.provider)
          .map((n) => [n.provider!.name, n.provider!.name])
      ).entries()
    ).sort(([a], [b]) => a.localeCompare(b));

    const uniqueServices = Array.from(
      new Set(
        nodes.flatMap((n) => (n.services ?? []).map((s: { serviceId: string }) => s.serviceId))
      )
    ).sort((a, b) => a.localeCompare(b));

    return [
      {
        group: "bin/status",
        items: [
          [
            { label: "All Nodes", value: "", column: "status" },
            { label: "Staked", value: "staked", column: "status", isDefault: true },
            { label: "Unstaking", value: "unstaking", column: "status" },
            { label: "Unstaked", value: "unstaked", column: "status" },
          ],
        ],
      },
      {
        group: "providers",
        items: [
          [
            { label: "All Providers", value: "", column: "provider", isDefault: true },
            ...uniqueProviders.map(([name]) => ({
              label: name,
              value: name,
              column: "provider" as keyof NodeDetails,
            })),
          ],
        ],
      },
      {
        group: "services",
        items: [
          [
            { label: "All Services", value: "", column: "services", isDefault: true },
            ...uniqueServices.map((id) => ({
              label: id,
              value: id,
              column: "services" as keyof NodeDetails,
            })),
          ],
        ],
      },
    ];
  }, [nodes]);

  return (
    <DataTable
      columns={columns}
      data={nodes}
      filters={filters}
      sorts={sorts}
      columnVisibility={{ services: false }}
      isLoading={isLoading}
      isError={isError}
      refetch={refetch}
      csvFilename={'nodes'}
      searchableColumns={['address', 'ownerAddress', 'provider']}
      searchPlaceholder="Search by address or provider..."
    />
  )
}
