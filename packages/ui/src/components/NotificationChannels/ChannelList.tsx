'use client'

import React, { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import { Switch } from '@igniter/ui/components/switch'
import { LoaderIcon } from '@igniter/ui/assets'
import { PencilIcon, Trash2Icon, SendIcon } from 'lucide-react'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import type { ColumnDef } from '@igniter/ui/components/table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'

// Minimal result contract the host app's server actions must satisfy. Apps
// (provider, middleman) return their own richer ActionResult — its error need
// only carry a message — so this stays decoupled from any one app's auth layer.
export type ChannelActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { message: string } }

// The minimal channel shape the list renders. Apps pass their richer row type
// (the channel record minus its secret config); only these fields are read.
export type ChannelListItem = {
  id: number
  name: string
  type: string
  enabled: boolean
}

export interface ChannelListActions<T extends ChannelListItem> {
  list: () => Promise<ChannelActionResult<T[]>>
  update: (id: number, data: { enabled: boolean }) => Promise<ChannelActionResult<unknown>>
  remove: (id: number) => Promise<ChannelActionResult<unknown>>
  test: (id: number) => Promise<ChannelActionResult<unknown>>
}

const DEFAULT_TYPE_LABELS: Record<string, string> = {
  discord: 'Discord',
  telegram: 'Telegram',
  email: 'Email',
}

export interface ChannelListProps<T extends ChannelListItem> {
  actions: ChannelListActions<T>
  /** Map of channel-type value -> display label. Defaults to discord/telegram/email. */
  typeLabels?: Record<string, string>
  /**
   * Renders the edit form for a channel. Injected so the list does not depend
   * on an app-specific channel form (provider and middleman diverge on the
   * email/SMTP fields). `onClose(changed)` refetches when changed is true.
   */
  renderEditForm: (channel: T, onClose: (changed: boolean) => void) => React.ReactNode
}

export function ChannelList<T extends ChannelListItem>({
  actions,
  typeLabels = DEFAULT_TYPE_LABELS,
  renderEditForm,
}: ChannelListProps<T>) {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()

  const [editChannel, setEditChannel] = useState<T | undefined>()
  const [deleteChannel, setDeleteChannel] = useState<T | undefined>()
  const [testingId, setTestingId] = useState<number | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const {
    data: channels,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: async () => {
      const result = await actions.list()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    initialData: [] as T[],
    refetchInterval: 60000,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await actions.remove(id)
      if (!result.success) throw new Error(result.error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      setDeleteChannel(undefined)
      addNotification({ id: 'channel-deleted', type: 'success', showTypeIcon: true, content: 'Channel deleted.' })
    },
    onError: (err) => {
      addNotification({ id: 'channel-delete-error', type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : 'Failed to delete channel.' })
    },
  })

  const handleToggle = useCallback(
    async (channel: T) => {
      setTogglingId(channel.id)
      try {
        const result = await actions.update(channel.id, { enabled: !channel.enabled })
        if (!result.success) throw new Error(result.error.message)
        queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      } catch (err) {
        addNotification({ id: 'channel-toggle-error', type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : 'Failed to toggle channel.' })
      } finally {
        setTogglingId(null)
      }
    },
    [actions, queryClient, addNotification],
  )

  const handleTest = useCallback(
    async (channel: T) => {
      setTestingId(channel.id)
      try {
        const result = await actions.test(channel.id)
        if (!result.success) throw new Error(result.error.message)
        addNotification({ id: `channel-test-${channel.id}`, type: 'success', showTypeIcon: true, content: `Test message sent to "${channel.name}".` })
      } catch (err) {
        addNotification({ id: `channel-test-error-${channel.id}`, type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : `Failed to test "${channel.name}".` })
      } finally {
        setTestingId(null)
      }
    },
    [actions, addNotification],
  )

  const columns: Array<ColumnDef<T> & CsvColumnDef<T>> = [
    {
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const type = row.getValue('type') as string
        return typeLabels[type] ?? type
      },
    },
    {
      id: 'enabled',
      header: 'Enabled',
      cell: ({ row }) => {
        const ch = row.original
        return (
          <Switch
            checked={ch.enabled}
            onCheckedChange={() => handleToggle(ch)}
            disabled={togglingId === ch.id}
          />
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {editChannel && renderEditForm(editChannel, (changed) => {
        setEditChannel(undefined)
        if (changed) refetch()
      })}

      <DataTable
        isLoading={isLoading}
        isError={isError}
        refetch={refetch}
        columns={columns}
        data={channels}
        searchableColumns={['name']}
        itemActions={(ch) => {
          const isTesting = testingId === ch.id
          return (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="Send test message"
                disabled={isTesting}
                onClick={() => handleTest(ch)}
              >
                {isTesting ? (
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <SendIcon className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Edit channel"
                onClick={() => setEditChannel(ch)}
              >
                <PencilIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Delete channel"
                onClick={() => setDeleteChannel(ch)}
              >
                <Trash2Icon className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          )
        }}
      />

      {deleteChannel && (
        <ConfirmationDialog
          title="Delete Channel"
          open={!!deleteChannel}
          onClose={() => setDeleteChannel(undefined)}
          footerActions={
            <>
              <Button variant="outline" onClick={() => setDeleteChannel(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteChannel.id)}
              >
                {deleteMutation.isPending && (
                  <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the channel &ldquo;{deleteChannel.name}&rdquo;? This
            action cannot be undone.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  )
}