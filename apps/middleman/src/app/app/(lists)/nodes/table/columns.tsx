"use client";

import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import {NodeWithDetails, Provider, Transaction} from '@igniter/db/middleman/schema'
import {NodeStatus} from '@igniter/db/middleman/enums'
import {
  CopyIcon,
  RightArrowIcon,
} from "@igniter/ui/assets";
import { Button } from "@igniter/ui/components/button";
import {
  FilterGroup,
  SortOption,
} from "@igniter/ui/components/DataTable/index";
import {
  amountToPokt,
  getShortAddress,
  roundAndSeparate,
} from "@igniter/ui/lib/utils";
import {CellContext, ColumnDef} from "@tanstack/react-table";
import { useCallback } from "react";
import { toast } from "sonner";
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider';

export type NodeDetails = NodeWithDetails & {
  height: number;
  transactions: Transaction[];
};

const createAddressCellRenderer = (attribute: keyof Pick<NodeDetails, 'address' | 'ownerAddress'>) => ({ row }: CellContext<NodeDetails, unknown>) => {
      const address = row.getValue(attribute) as string;

      const onClickCopy = useCallback(() => {
        navigator.clipboard.writeText(address).then(() => {
          toast.success("Address copied to clipboard");
        });
      }, [address]);

      return (
          <div className="flex items-center gap-2">
          <span className="font-mono text-slightly-muted-foreground flex justify-center items-center gap-2 text-pink-1 font-medium">
            {getShortAddress(address, 5)}
            <CopyIcon onClick={onClickCopy} className="cursor-pointer" />
          </span>
          </div>
      );
};

export const columns: (ColumnDef<NodeDetails> & CsvColumnDef<NodeDetails>)[] = [
  {
    accessorKey: "address",
    header: "Address",
    cell: createAddressCellRenderer('address'),
    csvFormatterFn: (item: NodeDetails) => item.address,
  },
  {
    accessorKey: "ownerAddress",
    header: "Owner",
    cell: createAddressCellRenderer('ownerAddress'),
    csvFormatterFn: (item: NodeDetails) => item.ownerAddress,
  },
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => {
      const provider = row.getValue("provider") as Provider;
      return (
        <div className="flex items-center gap-2">
          <span className="text-slightly-muted-foreground flex justify-center items-center gap-2">
            {provider?.name || "Imported Node"}
          </span>
        </div>
      );
    },
    filterFn: (row, _columnId, value) => {
      const provider = row.getValue("provider") as Provider;
      return provider.name.toLowerCase().includes(value.toLowerCase());
    },
    csvFormatterFn: (item: NodeDetails) => item.provider?.name || "Imported Node",
  },
  {
    id: "height",
    header: "Height",
    accessorKey: "height",
    meta: {
      headerAlign: 'right'
    },
    csvFormatterFn: (item: NodeDetails) => item.height.toString(),
    cell: ({ row }) => {
      return (
        <span className="font-mono flex justify-end">
          {row.original.height ?? "-"}
        </span>
      );
    },
    sortingFn: "basic",
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const status = row.getValue("status") as NodeStatus;
      return (
        <span className="flex justify-center gap-2">
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      );
    },
    csvFormatterFn: (item: NodeDetails) => item.status.charAt(0).toUpperCase() + item.status.slice(1),
  },
  {
    accessorKey: "stakeAmount",
    header: "Stake Amount (POKT)",
    meta: {
      headerAlign: 'right'
    },
    cell: ({ row }) => {
      const stakeAmount = amountToPokt(row.getValue("stakeAmount")) as number;

      return (
        <div className="flex items-baseline gap-3 font-mono justify-end">
          <span>{roundAndSeparate(stakeAmount)}</span>
          <span className="text-text-tertiary">$POKT</span>
        </div>
      );
    },
    csvFormatterFn: (item: NodeDetails) => amountToPokt(item.stakeAmount).toString(),
  },
  {
    accessorKey: "balance",
    header: "Balance (POKT)",
    meta: {
      headerAlign: 'right'
    },
    cell: ({ row }) => {
      const balance = row.getValue("balance") as number;
      return (
        <div className="flex items-baseline gap-3 font-mono justify-end">
          <span>{roundAndSeparate(amountToPokt(balance), 2)}</span>
          <span className="text-text-tertiary">$POKT</span>
        </div>
      );
    },
    csvFormatterFn: (item: NodeDetails) => amountToPokt(item.balance.toString()).toString(),
  },
  {
    accessorKey: "createdAt",
    header: "Created At",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const createdAt = new Date(row.getValue("createdAt"));
      return (
          <span className="font-mono text-slightly-muted-foreground flex justify-center gap-2">
          {createdAt.toLocaleString()}
        </span>
      );
    },
    csvFormatterFn: (item: NodeDetails) => new Date(item.createdAt).toLocaleString(),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const addItem = useAddItemToDetail()
      const node = row.original;
      return (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="border-0"
            onClick={() => {
              addItem({
                type: 'node',
                body: {
                  id: node.id,
                  address: node.address,
                  ownerAddress: node.ownerAddress,
                  status: node.status,
                  stakeAmount: Number(node.stakeAmount),
                  operationalFundsAmount: Number(node.balance.toString()),
                  provider: node.provider,
                  services: node.services ?? [],
                  transactions: node.transactions.map(t => ({
                    id: t.id,
                    type: t.type,
                    status: t.status,
                    createdAt: t.createdAt!,
                    operations: JSON.parse(t.unsignedPayload).body.messages,
                    hash: t.hash || '',
                    estimatedFee: t.estimatedFee,
                    consumedFee: t.consumedFee,
                    provider: node.provider?.name || '',
                    providerFee: t.providerFee,
                    typeProviderFee: t.typeProviderFee,
                  })),
                }
              })
            }}
          >
            <RightArrowIcon style={{ width: "18px", height: "18px" }} />
          </Button>
        </div>
      );
    },
  },
];

export const filters: FilterGroup<NodeDetails>[] = [
  {
    group: "bin/status",
    items: [
      [
        {
          label: "All Nodes",
          value: "",
          column: "status",
          isDefault: true,
        },
        {
          label: "Staked",
          value: "staked",
          column: "status",
          isDefault: true,
        },
        {
          label: "Unstaking",
          value: "unstaking",
          column: "status",
          isDefault: true,
        },
      ],
    ],
  },
  {
    group: "providers",
    items: [
      [
        {
          label: "All Providers",
          value: "",
          column: "provider",
          isDefault: true,
        },
      ],
    ],
  },
];

export const sorts: SortOption<NodeDetails>[][] = [
  [
    {
      label: "Height",
      column: "height",
      direction: "desc",
      isDefault: true,
    },
  ],
];
