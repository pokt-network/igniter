'use client'

import React, { useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import { PlusIcon } from 'lucide-react'
import { ChannelList } from './ChannelList'
import { ChannelForm } from './ChannelForm'

export function NotificationsManager() {
  const [adding, setAdding] = useState(false)
  // Remount the list after an add so the new channel shows immediately (the
  // list owns its own react-query cache; the create form lives outside it).
  const [listKey, setListKey] = useState(0)

  return (
    <div className="flex flex-col gap-4">
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
