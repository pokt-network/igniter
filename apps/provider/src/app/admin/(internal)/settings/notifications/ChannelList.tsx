'use client'

import React from 'react'
import { ChannelList as SharedChannelList } from '@igniter/ui/components/NotificationChannels/ChannelList'
import type { NotificationChannelListItem } from '@/lib/dal/notificationChannels'
import {
  ListNotificationChannels,
  DeleteNotificationChannel,
  UpdateNotificationChannel,
  TestNotificationChannel,
} from '@/actions/NotificationChannels'
import { ChannelForm } from './ChannelForm'

// Provider-scoped wiring of the shared notification ChannelList: owner-gated
// server actions + the provider channel form (recipients-only email; SMTP comes
// from the singleton config). The list/table/test/delete/toggle UI is shared.
export function ChannelList() {
  return (
    <SharedChannelList<NotificationChannelListItem>
      actions={{
        list: ListNotificationChannels,
        update: (id, data) => UpdateNotificationChannel(id, data),
        remove: DeleteNotificationChannel,
        test: TestNotificationChannel,
      }}
      renderEditForm={(channel, onClose) => (
        <ChannelForm channel={channel} onClose={onClose} />
      )}
    />
  )
}