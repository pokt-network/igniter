import React from 'react'
import { ColumnDef } from "@igniter/ui/components/table";
import { KeyState, KeyStateNameMap } from '@igniter/db/provider/enums'
import { FilterGroup, SortOption } from '@igniter/ui/components/DataTable/index'
import Address from '@igniter/ui/components/Address'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { getShortAddress, amountToPokt, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { formatRelativeTime } from '@/lib/utils/time'
import { Badge } from '@igniter/ui/components/badge'
import {
  KeyStateLabels,
  deriveKeyLifecycleStatus,
  keyLifecycleStatusBadgeVariant,
  RETIRED_LIFECYCLE_LABEL,
} from "@/app/admin/(internal)/keys/constants";
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
  } | null
  state: KeyState
  ownerAddress: string | null
  delegator: {
    name: string
    identity: string
  } | null
  createdAt: Date
}

export function getColumns(
  pendingUnstakeAddresses?: Set<string>,
): Array<ColumnDef<KeyWithRelations> & CsvColumnDef<KeyWithRelations>> {
  return [
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
    // id stays "state" so the existing "state" FilterGroup and sorts keep
    // targeting this column. The accessor now returns the DERIVED lifecycle
    // status ('Retired' when retiredAt is set, else the KeyState label) so the
    // badge and the client-side filter share one source of truth.
    id: "state",
    accessorFn: (row) => deriveKeyLifecycleStatus(row),
    header: "State",
    filterFn: 'equals',
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const state = row.original.state as KeyState;
      const lifecycleStatus = deriveKeyLifecycleStatus(row.original);
      const isRetired = lifecycleStatus === RETIRED_LIFECYCLE_LABEL;
      // (a) Retired wins outright: retiredAt set => "Retired" regardless of state.
      // (b) Otherwise, fast in-progress feedback: a pending unstake tx exists but
      //     the key.state hasn't flipped to Unstaking yet (that only happens on
      //     tx verification). Once the real flip lands, the normal KeyState path
      //     takes over. (c) Otherwise, the normal KeyState badge.
      if (
        !isRetired &&
        pendingUnstakeAddresses?.has(row.original.address) &&
        state === KeyState.Staked
      ) {
        return (
          <span className="flex justify-center gap-2">
            <Badge variant="warning">Unstaking…</Badge>
          </span>
        );
      }
      const label = isRetired
        ? RETIRED_LIFECYCLE_LABEL
        : KeyStateNameMap[state] || state;
      const variant = keyLifecycleStatusBadgeVariant(lifecycleStatus, state);
      return (
        <span className="flex justify-center gap-2">
          <Badge variant={variant}>{label}</Badge>
        </span>
      );
    },
  },
  {
    accessorKey: "stakeAmountUpokt",
    header: "Stake (POKT)",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const upokt = Number(row.original.stakeAmountUpokt ?? 0);
      if (!upokt) {
        return <span className="flex justify-center text-text-tertiary">—</span>;
      }
      return (
        <span className="flex justify-center font-mono">
          {toCurrencyFormat(amountToPokt(upokt), 2, 2)}
        </span>
      );
    },
  },
  {
    accessorKey: "balanceUpokt",
    header: "Op. Funds (POKT)",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const upokt = Number(row.original.balanceUpokt ?? 0);
      if (!upokt) {
        return <span className="flex justify-center text-text-tertiary">—</span>;
      }
      return (
        <span className="flex justify-center font-mono">
          {toCurrencyFormat(amountToPokt(upokt), 2, 2)}
        </span>
      );
    },
  },
  {
    id: "services",
    accessorFn: (row) => row.services?.length ?? 0,
    header: "Services",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const count = row.original.services?.length ?? 0;
      return (
        <span className="flex justify-center">
          {count > 0 ? count : <span className="text-text-tertiary">—</span>}
        </span>
      );
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Last Updated",
    meta: {
      headerAlign: 'center'
    },
    cell: ({ row }) => {
      const updatedAt = row.original.updatedAt;
      return (
        <span
          className="font-mono text-slightly-muted-foreground flex justify-center"
          title={updatedAt ? new Date(updatedAt).toLocaleString() : undefined}
        >
          {formatRelativeTime(updatedAt)}
        </span>
      );
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
    // Kept only to power the Address Group filter — hidden from the table via
    // columnVisibility (identity/org lives in filters + the detail panel, not the
    // metrics-focused list). Tanstack still needs the column present to filter on it.
    accessorKey: "addressGroup",
    header: "Address Group",
    cell: ({ row }) => {
      const addressGroup = row.getValue("addressGroup") as Key['addressGroup'];
      return <span>{addressGroup?.name || '-'}</span>;
    },
    filterFn: (row, columnId, value) => {
      const addressGroup = row.getValue("addressGroup") as Key['addressGroup'];
      if (!addressGroup) return false;
      return typeof value === 'string' ? addressGroup.name.toLowerCase().includes(value.toLowerCase()) : addressGroup.id === value;
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
}

export const columns = getColumns()

export function getFilters(addressesGroup: AddressGroup[], keys: KeyWithRelations[]): Array<FilterGroup<KeyWithRelations>> {
  const distinctOwners = [...new Set(keys.map(k => k.ownerAddress).filter(Boolean))] as string[]
  // Distinct DERIVED lifecycle statuses present in the data, ordered by the
  // canonical KeyState order with "Retired" appended last (so the filter lists
  // only statuses that actually occur, including "Retired" when retired keys exist).
  const presentStatuses = new Set(keys.map((k) => deriveKeyLifecycleStatus(k)))
  const distinctLifecycleStatuses = [
    ...Object.values(KeyState)
      .map((state) => KeyStateLabels[state])
      .filter((label) => presentStatuses.has(label)),
    ...(presentStatuses.has(RETIRED_LIFECYCLE_LABEL) ? [RETIRED_LIFECYCLE_LABEL] : []),
  ]
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
        // Options are the DERIVED lifecycle statuses present in the data: the
        // KeyState labels of non-retired keys, plus "Retired" if any key has
        // retiredAt set. The value equals the derived accessor output (the
        // label string) so filterFn 'equals' on the "state" column matches.
        // Filtering by "Retired" -> keys with retiredAt; filtering by e.g.
        // "Staked" -> Staked keys, excluding retired ones (their status is
        // "Retired", not their raw state).
        distinctLifecycleStatuses.map((status) => ({
          label: status,
          value: status,
          column: "state"
        }))
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
      label: "Recently Updated",
      column: "updatedAt",
      direction: "desc",
      isDefault: true,
    },
    {
      label: "Highest Stake",
      column: "stakeAmountUpokt",
      direction: "desc",
    },
    {
      label: "Lowest Op. Funds",
      column: "balanceUpokt",
      direction: "asc",
    },
  ],
]
