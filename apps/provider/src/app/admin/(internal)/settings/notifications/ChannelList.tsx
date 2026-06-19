'use client'

import React, { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import DataTable from '@igniter/ui/components/DataTable/index'
import { Button } from '@igniter/ui/components/button'
import { Switch } from '@igniter/ui/components/switch'
import { LoaderIcon } from '@igniter/ui/assets'
import { PencilIcon, Trash2Icon, SendIcon } from 'lucide-react'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import type { NotificationChannelListItem } from '@/lib/dal/notificationChannels'
import { NotificationChannelType } from '@igniter/db/provider/enums'
import {
  ListNotificationChannels,
  DeleteNotificationChannel,
  UpdateNotificationChannel,
  TestNotificationChannel,
} from '@/actions/NotificationChannels'
import { ChannelForm } from './ChannelForm'
import type { ColumnDef } from '@igniter/ui/components/table'
import type { CsvColumnDef } from '@igniter/ui/lib/csv'

const TYPE_LABELS: Record<NotificationChannelType, string> = {
  [NotificationChannelType.Discord]: 'Discord',
  [NotificationChannelType.Telegram]: 'Telegram',
  [NotificationChannelType.Email]: 'Email',
}

export function ChannelList() {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()

  const [editChannel, setEditChannel] = useState<NotificationChannelListItem | undefined>()
  const [deleteChannel, setDeleteChannel] = useState<NotificationChannelListItem | undefined>()
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
      const result = await ListNotificationChannels()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    initialData: [],
    refetchInterval: 60000,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await DeleteNotificationChannel(id)
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
    async (channel: NotificationChannelListItem) => {
      setTogglingId(channel.id)
      try {
        const result = await UpdateNotificationChannel(channel.id, { enabled: !channel.enabled })
        if (!result.success) throw new Error(result.error.message)
        queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
      } catch (err) {
        addNotification({ id: 'channel-toggle-error', type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : 'Failed to toggle channel.' })
      } finally {
        setTogglingId(null)
      }
    },
    [queryClient, addNotification],
  )

  const handleTest = useCallback(
    async (channel: NotificationChannelListItem) => {
      setTestingId(channel.id)
      try {
        const result = await TestNotificationChannel(channel.id)
        if (!result.success) throw new Error(result.error.message)
        addNotification({ id: `channel-test-${channel.id}`, type: 'success', showTypeIcon: true, content: `Test message sent to "${channel.name}".` })
      } catch (err) {
        addNotification({ id: `channel-test-error-${channel.id}`, type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : `Failed to test "${channel.name}".` })
      } finally {
        setTestingId(null)
      }
    },
    [addNotification],
  )

  const columns: Array<ColumnDef<NotificationChannelListItem> & CsvColumnDef<NotificationChannelListItem>> = [
    {
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => TYPE_LABELS[row.getValue('type') as NotificationChannelType] ?? row.getValue('type'),
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
      {editChannel && (
        <ChannelForm
          channel={editChannel}
          onClose={(changed) => {
            setEditChannel(undefined)
            if (changed) refetch()
          }}
        />
      )}

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