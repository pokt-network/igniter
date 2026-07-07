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

// Per-wallet wiring of the shared notification ChannelList: wallet-scoped server
// actions + the middleman channel form (email channels carry their own SMTP).
export function ChannelList() {
  return (
    <SharedChannelList<NotificationChannelListItem>
      actions={{
        list: ListNotificationChannels,
        update: (id, data) => UpdateNotificationChannel(id, data),
        remove: DeleteNotificationChannel,
        test: TestNotificationChannel,
      }}
      renderEditForm={(channel, onClose) => <ChannelForm channel={channel} onClose={onClose} />}
    />
  )
}
