'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@igniter/ui/components/button'
import { Switch } from '@igniter/ui/components/switch'
import { Label } from '@igniter/ui/components/label'
import { PlusIcon } from 'lucide-react'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { ChannelList } from './ChannelList'
import { ChannelForm } from './ChannelForm'
import { GetNotificationPreferences, SetInAppFeedEnabled } from '@/actions/NotificationChannels'

export function NotificationsManager() {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()
  const [adding, setAdding] = useState(false)
  // Remount the list after an add so the new channel shows immediately (the
  // list owns its own react-query cache; the create form lives outside it).
  const [listKey, setListKey] = useState(0)

  const { data: prefs } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await GetNotificationPreferences()
      return res.success ? res.data : { inAppFeedEnabled: true }
    },
  })

  async function toggleFeed(enabled: boolean) {
    const res = await SetInAppFeedEnabled(enabled)
    if (!res.success) {
      addNotification({
        id: 'feed-pref-error',
        type: 'error',
        showTypeIcon: true,
        content: res.error.message || 'Failed to update preference.',
      })
    }
    // Refetch so the Switch reflects the stored value (snaps back on failure).
    queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <Label>In-app notifications</Label>
          <p className="text-xs text-text-secondary">
            Show notification updates in the header. Delivery to your channels is unaffected.
          </p>
        </div>
        <Switch checked={prefs?.inAppFeedEnabled ?? true} onCheckedChange={toggleFeed} />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <PlusIcon className="mr-2 h-4 w-4" />
          Add channel
        </Button>
      </div>

      <ChannelList key={listKey} />

      {adding && (
        <ChannelForm
          onClose={(changed) => {
            setAdding(false)
            if (changed) setListKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
