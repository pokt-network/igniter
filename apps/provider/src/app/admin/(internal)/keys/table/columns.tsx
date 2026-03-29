import React from 'react'
import { ColumnDef } from "@igniter/ui/components/table";
import { KeyState } from '@igniter/db/provider/enums'
import { FilterGroup, SortOption } from '@igniter/ui/components/DataTable/index'
import Address from '@igniter/ui/components/Address'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { getShortAddress } from '@igniter/ui/lib/utils'
import {KeyStateLabels} from "@/app/admin/(internal)/keys/constants";
import {useAddItemToDetail} from "@igniter/ui/components/QuickDetails/Provider";
import {Button} from "@igniter/ui/components/button";
import {RightArrowIcon} from "@igniter/ui/assets";
import {KeyWithRelations, AddressGroup} from "@igniter/db/provider/schema";
import {CsvColumnDef} from "@igniter/ui/lib/csv";

export interface Key {
  id: number
  address: string
  addressGroup: {
    id: number
    name: string
  }
  state: KeyState
  ownerAddress: string | null
  delegator: {
    name: string
    identity: string
  } | null
  createdAt: Date
}

export const columns: Array<ColumnDef<KeyWithRelations> & CsvColumnDef<KeyWithRelations>> = [
  {
    accessorKey: "address",
    header: "Address",
    cell: ({ row }) => {
      const address = row.getValue("address") as string;

      return (
        <Address address={address} />
      );
    },
  },
  {
    accessorKey: "addressGroup",
    header: "Address Group",
    cell: ({ row }) => {
      const addressGroup = row.getValue("addressGroup") as Key['addressGroup'];
      return (
        <div className="flex items-center gap-2">
          <span className="text-slightly-muted-foreground flex justify-center items-center gap-2">
            {addressGroup.name}
          </span>
        </div>
      );
    },
    filterFn: (row, columnId, value) => {
      const addressGroup = row.getValue("addressGroup") as Key['addressGroup'];
      return typeof value === 'string' ? addressGroup.name.toLowerCase().includes(value.toLowerCase()) : addressGroup.id === value;
    },
  },
  {
    accessorKey: "ownerAddress",
    header: "Owner",
    cell: ({ row }) => {
      const ownerAddress = row.getValue("ownerAddress") as string;

      if (!ownerAddress) {
        return <span className="text-text-tertiary">Owner Not Set</span>;
      }

      return <Address address={ownerAddress} showAvatar />;
    },
    filterFn: (row, _columnId, value) => {
      const ownerAddress = row.getValue("ownerAddress") as string;
      if (value === '__none__') return !ownerAddress;
      return ownerAddress === value;
    },
  },
  {
    accessorKey: "state",
    header: "State",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const status = row.getValue("state") as KeyState;
      return (
        <span className="flex justify-center gap-2">
          {KeyStateLabels[status] || status}
        </span>
      );
    },
  },
  {
    accessorKey: "delegator",
    header: "Delivered To",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const delegator = row.getValue("delegator") as Key['delegator'];

      return (
        <span className="flex justify-center gap-2">
          {delegator?.name || '-'}
        </span>
      );
    },
    filterFn: (row, _columnId, value) => {
      const delegator = row.getValue("delegator") as Key['delegator'];
      if (value === '__none__') return !delegator;
      if (!delegator) return false;
      return delegator.identity === value;
    },
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
  },
  {
    id: "actions",
    cell: ({row}) => {
      const addItem = useAddItemToDetail()
      return (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="border-0"
            onClick={() => {
              addItem({
                type: 'key',
                body: {
                  ...row.original
                }
              })
            }}
          >
            <RightArrowIcon style={{width: "18px", height: "18px"}}/>
          </Button>
        </div>
      );
    },
  },
]

export function getFilters(addressesGroup: AddressGroup[], keys: KeyWithRelations[]): Array<FilterGroup<KeyWithRelations>> {
  const distinctOwners = [...new Set(keys.map(k => k.ownerAddress).filter(Boolean))] as string[]
  const delegatorMap = new Map<string, string>()
  for (const key of keys) {
    if (key.delegator) {
      delegatorMap.set(key.delegator.identity, key.delegator.name)
    }
  }

  const filters: Array<FilterGroup<KeyWithRelations>> = [
    {
      group: "state",
      items: [
        [{label: "All Keys", value: "", column: "state", isDefault: true}],
        (Object.values(KeyState).map((state) => ({
          label: KeyStateLabels[state],
          value: state,
          column: "state"
        })))
      ]
    },
    {
      group: 'addressGroup',
      items: [
        [{label: "All Address Groups", value: "", column: "addressGroup", isDefault: true}],
        (addressesGroup.map((addressGroup: { name: any; id: any; }) => ({
          label: addressGroup.name,
          value: addressGroup.id,
          column: "addressGroup"
        })))
      ]
    },
  ]

  const hasKeysWithoutOwner = keys.some(k => !k.ownerAddress)
  const hasKeysWithoutDelegator = keys.some(k => !k.delegator)

  if (distinctOwners.length > 0 || hasKeysWithoutOwner) {
    filters.push({
      group: 'ownerAddress',
      items: [
        [{label: "All Owners", value: "", column: "ownerAddress", isDefault: true}],
        [
          ...(hasKeysWithoutOwner ? [{
            label: "No Owner",
            value: "__none__",
            column: "ownerAddress" as keyof KeyWithRelations,
          }] : []),
          ...distinctOwners.map((owner) => ({
            label: <><AvatarByString string={owner} size={14} />{getShortAddress(owner, 5)}</>,
            value: owner,
            column: "ownerAddress" as keyof KeyWithRelations,
          })),
        ]
      ]
    })
  }

  if (delegatorMap.size > 0 || hasKeysWithoutDelegator) {
    filters.push({
      group: 'delegator',
      items: [
        [{label: "All Delegators", value: "", column: "delegator", isDefault: true}],
        [
          ...(hasKeysWithoutDelegator ? [{
            label: "No Delegator",
            value: "__none__",
            column: "delegator" as keyof KeyWithRelations,
          }] : []),
          ...[...delegatorMap.entries()].map(([identity, name]) => ({
            label: name,
            value: identity,
            column: "delegator" as keyof KeyWithRelations,
          })),
        ]
      ]
    })
  }

  return filters
}

export const sorts: Array<Array<SortOption<KeyWithRelations>>> = [
  [
    {
      label: "Most Recent",
      column: "createdAt",
      direction: "desc",
      isDefault: true,
    },
  ],
]
