'use client'

import type { RelayMiner } from '@igniter/db/provider/schema'
import { useState } from 'react'
import {
  DeleteRelayMiner,
  ListRelayMiners,
} from '@/actions/RelayMiners'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import DataTable from '@igniter/ui/components/DataTable/index'
import {
  columns,
  getFilters,
} from './columns'
import { AddOrUpdateRelayMinerDialog } from '@/components/AddOrUpdateRelayMinerDialog'
import { useQuery } from '@tanstack/react-query'
import {
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { useNotifications } from '@igniter/ui/context/Notifications/index'

export default function RelayMinersTable() {
  const { data: relayMiners, refetch: fetchRelayMiners, isLoading: isLoadingRelayMiners, isError } = useQuery({
    queryKey: ['relay-miners'],
    queryFn: async () => {
      const result = await ListRelayMiners();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: [],
  })

  const [isAddingRelayMiner, setIsAddingRelayMiner] = useState(false)
  const [isDeletingRelayMiner, setIsDeletingRelayMiner] = useState(false)
  const [updateRelayMiner, setUpdateRelayMiner] = useState<RelayMiner | null>(null)
  const [relayMinerToDelete, setRelayMinerToDelete] = useState<RelayMiner | null>(null)
  const { addNotification } = useNotifications()

  const isLoading = isLoadingRelayMiners || isDeletingRelayMiner

  const content = (
    <DataTable
      isError={isError}
      isLoading={isLoading}
      refetch={fetchRelayMiners}
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
                onClick={() => setUpdateRelayMiner(row.original)}
                title="Edit Relay Miner"
              >
                <PencilIcon className="h-4 w-4"/>
              </Button>
              <Button
                disabled={isLoading}
                variant="ghost"
                size="icon"
                onClick={() => setRelayMinerToDelete(row.original)}
                title="Delete Relay Miner"
              >
                <Trash2Icon className="h-4 w-4 text-red-500"/>
              </Button>
            </div>
          ),
        },
      ]}
      data={relayMiners}
      filters={getFilters(relayMiners)}
      sorts={[]}
    />
  )

  const confirmDeleteRelayMiner = async () => {
    if (!relayMinerToDelete) return

    try {
      setIsDeletingRelayMiner(true)
      const result = await DeleteRelayMiner(relayMinerToDelete.id)
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await fetchRelayMiners()
    } catch (error) {
      console.error('Failed to delete relay miner:', error)
      addNotification({
        id: `delete-relay-miner-error`,
        type: 'error',
        showTypeIcon: true,
        content: error instanceof Error ? error.message : 'Unable to delete relay miner. Please ensure it\'s not associated with any address groups before trying again.',
      })
    } finally {
      setIsDeletingRelayMiner(false)
      setRelayMinerToDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isAddingRelayMiner && (
        <AddOrUpdateRelayMinerDialog
          onClose={(shouldRefreshRelayMiners) => {
            setIsAddingRelayMiner(false)

            if (shouldRefreshRelayMiners) {
              fetchRelayMiners()
            }
          }}
        />
      )}

      {updateRelayMiner && (
        <AddOrUpdateRelayMinerDialog
          onClose={(shouldRefreshRelayMiners) => {
            setUpdateRelayMiner(null)

            if (shouldRefreshRelayMiners) {
              fetchRelayMiners()
            }
          }}
          relayMiner={updateRelayMiner}
        />
      )}
      <div className="py-2 max-h-[500px] min-h-[300px] overflow-y-scroll scrollbar-hidden">
        {content}
      </div>
      {relayMinerToDelete && (
        <ConfirmationDialog
          title="Delete Relay Miner"
          open={!!relayMinerToDelete}
          onClose={() => setRelayMinerToDelete(null)}
          footerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setRelayMinerToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteRelayMiner()}
                disabled={isLoading}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the Relay Miner &quot;{relayMinerToDelete.name}&quot;?
            This action cannot be undone.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  )
}
