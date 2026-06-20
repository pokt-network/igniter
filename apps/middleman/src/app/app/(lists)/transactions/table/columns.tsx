"use client";

import type { ColumnDef } from '@tanstack/react-table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'
import { ProviderFee, TransactionStatus, TransactionType } from '@igniter/db/middleman/enums'
import {ActivitySuccessIcon, ActivityWarningIcon, RightArrowIcon} from '@igniter/ui/assets'
import { Button } from '@igniter/ui/components/button'
import { FilterGroup, SortOption } from '@igniter/ui/components/DataTable/index'
import { amountToPokt } from '@igniter/ui/lib/utils'
import { useAddItemToDetail } from '@igniter/ui/components/QuickDetails/Provider'
import Amount from '@igniter/ui/components/Amount'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import { TransactionStatusBadge } from '@/lib/transactions/statusBadge'
import {Operation} from "@/app/detail/TransactionDetail";

export type Transaction = {
    id: number;
    type: TransactionType;
    status: TransactionStatus;
    operations: Array<Operation>;
    executionHeight: string;
    createdAt: Date;
    totalValue: number;
    hash: string,
    estimatedFee: number,
    consumedFee?: number,
    provider: string,
    providerFee?: number | null,
    typeProviderFee?: ProviderFee | null,
};

export const columns: (ColumnDef<Transaction> & CsvColumnDef<Transaction>)[] = [
    {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => {
            const type = row.getValue("type") as TransactionType;
            const status = row.getValue("status") as TransactionStatus;
            return (
                <div className="flex items-center gap-2">
          <span
              className={type === TransactionType.Unstake ? "rotate-180" : ""}
              style={{ display: "inline-block" }}
          >
            {status === TransactionStatus.Failure ? (
                <ActivityWarningIcon />
            ) : (
                <ActivitySuccessIcon />
            )}
          </span>
                    <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                </div>
            );
        },
        filterFn: (row, columnId, value) => {
            const rowValue = row.getValue(columnId);
            return rowValue === value;
        },
        csvFormatterFn: (item) => item.type.charAt(0).toUpperCase() + item.type.slice(1)
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as TransactionStatus;
            return <TransactionStatusBadge status={status} />;
        },
        csvFormatterFn: ({status}) => status.charAt(0).toUpperCase() + status.slice(1),
    },
    {
        id: "hash",
        header: "Tx Hash",
        cell: ({ row }) => {
            const hash = row.original.hash;
            return hash ? <TransactionHash hash={hash} /> : <span className="text-muted-foreground">-</span>;
        },
        csvFormatterFn: (item) => item.hash || '-',
    },
    {
        id: "height",
        header: "Height",
        cell: ({row}) => row.original.executionHeight,
        csvFormatterFn: (item) => item.executionHeight.toString(),
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
        csvFormatterFn: (item) => new Date(item.createdAt).toLocaleString(),
    },
    {
        accessorKey: "totalValue",
        header: "Total POKT",
        meta: {
            headerAlign: 'right'
        },
        cell: ({ row }) => {
            const totalValue = row.getValue("totalValue") as number;
            return (
                <div className="flex items-baseline gap-3 font-mono justify-end">
                    <Amount value={amountToPokt(totalValue)} />
                </div>
            );
        },
        csvFormatterFn: item => amountToPokt(item.totalValue.toString()).toString(),
    },
    {
        id: "actions",
        cell: ({row}) => {
            const addItem = useAddItemToDetail()

            return (
                <div className="flex items-center justify-end">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="border-0"
                        onClick={() => {
                            addItem({
                                type: 'transaction',
                                body: {
                                    id: row.original.id,
                                    type: row.original.type,
                                    status: row.original.status,
                                    createdAt: row.original.createdAt,
                                    operations: row.original.operations,
                                    hash: row.original.hash,
                                    estimatedFee: row.original.estimatedFee,
                                    consumedFee: row.original.consumedFee,
                                    provider: row.original.provider,
                                    providerFee: row.original.providerFee,
                                    typeProviderFee: row.original.typeProviderFee,
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

export const filters: FilterGroup<Transaction>[] = [
    {
        group: "type/status",
        items: [
            [{ label: "All Transaction", value: "", column: "type", isDefault: true }],

            [
                { label: "Stake", value: TransactionType.Stake, column: "type" },
                { label: "Upstake", value: TransactionType.Upstake, column: "type" },
                { label: "Unstake", value: TransactionType.Unstake, column: "type" },
            ],

            [
                { label: "Success", value: TransactionStatus.Success, column: "status" },
                { label: "Failure", value: TransactionStatus.Failure, column: "status" },
                { label: "Pending", value: TransactionStatus.Pending, column: "status" },
                { label: "Not Executed", value: TransactionStatus.NotExecuted, column: "status" },
            ],
        ],
    },
];

export const sorts: SortOption<Transaction>[][] = [
    [
        {
            label: "Most Recent",
            column: "createdAt",
            direction: "desc",
            isDefault: true,
        },
    ],

    [
        { label: "Amount", column: "totalValue", direction: "desc" },
        { label: "Status", column: "status", direction: "asc" },
        { label: "Type", column: "type", direction: "asc" },
    ],
];
