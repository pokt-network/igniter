'use client'

import React, { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@igniter/ui/components/button'
import { PlusIcon } from 'lucide-react'
import { SmtpConfigForm } from './SmtpConfigForm'
import { ChannelList } from './ChannelList'
import { ChannelForm } from './ChannelForm'
export function NotificationChannelsSection() {
  const queryClient = useQueryClient()
  const [showAddChannel, setShowAddChannel] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/* SMTP — collapsible, header is part of SmtpConfigForm */}
      <SmtpConfigForm />

      <div className="h-px bg-border-primary" />

      {/* Channels */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
            Notification Channels
          </span>
          <Button size="sm" variant="outline" onClick={() => setShowAddChannel(true)}>
            <PlusIcon className="h-3.5 w-3.5 mr-1" />
            Add Channel
          </Button>
        </div>
        <p className="text-[11px] text-text-tertiary -mt-1">
          Supports <strong>Discord</strong> webhooks, <strong>Telegram</strong> bots, and <strong>Email</strong>.
          Each channel receives a summary message per event. Full details are available in the notification history.
        </p>

        <ChannelList />
      </div>

      {showAddChannel && (
        <ChannelForm
          onClose={(changed) => {
            setShowAddChannel(false)
            if (changed) {
              queryClient.invalidateQueries({ queryKey: ['notification-channels'] })
            }
          }}
        />
      )}
    </div>
  )
}
