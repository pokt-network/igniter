'use client'

import { useState } from 'react'
import type {
  AddressGroup,
  AddressGroupWithDetails,
} from '@igniter/db/provider/schema'
import {
  DeleteAddressGroup,
  ListAddressGroups,
} from '@/actions/AddressGroups'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import DataTable from '@igniter/ui/components/DataTable/index'
import {
  columns,
  filters,
  sorts,
} from './columns'
import { AddOrUpdateAddressGroupDialog } from '@/components/AddOrUpdateAddressGroupDialog'
import { useQuery } from '@tanstack/react-query'
import {
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { notify } from "@igniter/ui/lib/sessionMessages";
import { toast } from "@igniter/ui/components/sonner";
import { getLogger } from '@igniter/logger';

const log = getLogger(['provider', 'ui', 'table']);

export default function AddressGroupsTable() {
  const { data: addressGroups, refetch: fetchAddressGroups, isLoading: isLoadingAddressGroups, isError } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const result = await ListAddressGroups();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: [],
  })

  const [isAddingAddressGroup, setIsAddingAddressGroup] = useState(false)
  const [isDeletingAddressGroup, setIsDeletingAddressGroup] = useState(false)
  const [updateAddressGroup, setUpdateAddressGroup] = useState<AddressGroupWithDetails | null>(null)
  const [addressGroupToDelete, setAddressGroupToDelete] = useState<AddressGroup | null>(null)
  const isLoading = isLoadingAddressGroups || isDeletingAddressGroup

  const content = (
    <DataTable
      isError={isError}
      isLoading={isLoading}
      refetch={fetchAddressGroups}
      columns={[
        ...columns,
        {
          id: 'actions',
          header: '',
          cell: ({ row }) => (
            <div className="flex gap-2 justify-end">
              <Button
                disabled={isLoading}
                variant="ghost"
                size="icon"
                onClick={() => setUpdateAddressGroup(row.original)}
                title="Edit Address Group"
              >
                <PencilIcon className="h-4 w-4"/>
              </Button>
              <Button
                disabled={isLoading}
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (row.original.keysCount > 0) {
                    // A toast, not a bell card: nothing was attempted, so there
                    // is no outcome to review later — the click was simply
                    // refused, and the operator needs to see that immediately.
                    // Overrides the wrapper's persist-until-dismissed, which
                    // exists for raw server text; this is one short line.
                    const keys = row.original.keysCount
                    toast.warning('This address group cannot be deleted.', {
                      id: `ag-has-keys-error`,
                      duration: 6000,
                      description: `It has ${keys} key${keys === 1 ? '' : 's'} attached. Address groups with keys are protected from deletion.`,
                    })

                    return
                  }

                  setAddressGroupToDelete(row.original)
                }}
                title="Delete Address Group"
              >
                <Trash2Icon className="h-4 w-4 text-red-500"/>
              </Button>
            </div>
          ),
        },
      ]}
      data={addressGroups}
      filters={filters}
      sorts={sorts}
      searchableColumns={['name', 'relayMiner', 'linkedAddresses']}
      searchPlaceholder="Search by name, relay miner, or linked address..."
      countLabel="groups"
    />
  )

  const confirmDeleteAddressGroup = async () => {
    if (!addressGroupToDelete) return

    try {
      setIsDeletingAddressGroup(true)
      const result = await DeleteAddressGroup(addressGroupToDelete.id)
      if (!result.success) {
        // The trash button guards on keysCount, but that list is polled — a key
        // attached since the last refetch lands here instead. Same answer as the
        // guard rather than a filed failure.
        if (result.error.code === 'CONSTRAINT_VIOLATION') {
          toast.warning('This address group cannot be deleted.', {
            id: `ag-has-keys-error`,
            duration: 6000,
            description: 'It has keys attached. Address groups with keys are protected from deletion.',
          })
          // Refresh before leaving: the guard let this click through on a
          // keysCount that was already stale, and without a refetch the next
          // click repeats the whole dialog-then-toast round trip.
          await fetchAddressGroups()
          return
        }
        throw new Error(result.error.message);
      }
      await fetchAddressGroups()
    } catch (error) {
      log.error('Failed to delete addressGroup', { error: error })
      notify.error('Failed to delete the address group.', {
        id: `delete-ag-error`,
        description:
          error instanceof Error
            ? error.message
            : 'This could be due to a network issue or server problem. Please try again or contact support if the problem persists.',
      })
    } finally {
      setIsDeletingAddressGroup(false)
      setAddressGroupToDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isAddingAddressGroup && (
        <AddOrUpdateAddressGroupDialog
          onClose={(shouldRefreshAddressGroups) => {
            setIsAddingAddressGroup(false)

            if (shouldRefreshAddressGroups) {
              fetchAddressGroups()
            }
          }}
        />
      )}

      {updateAddressGroup && (
        <AddOrUpdateAddressGroupDialog
          onClose={(shouldRefreshAddressGroups) => {
            setUpdateAddressGroup(null)

            if (shouldRefreshAddressGroups) {
              fetchAddressGroups()
            }
          }}
          addressGroup={updateAddressGroup}
        />
      )}
      <div className="py-2">
        {content}
      </div>
      {addressGroupToDelete && (
        <ConfirmationDialog
          title="Delete AddressGroup"
          open={!!addressGroupToDelete}
          onClose={() => setAddressGroupToDelete(null)}
          footerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setAddressGroupToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteAddressGroup()}
                disabled={isLoading}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the Address Group &quot;{addressGroupToDelete.name}&quot;?
            This action cannot be undone.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  )
}
