'use client'

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { NotificationChannelsSection } from '@/app/admin/(internal)/settings/notifications/NotificationChannelsSection'

export interface ConfigureNotificationsProps {
  goNext?: () => void
  goBack?: () => void
}

export default function ConfigureNotifications({
  goNext,
  goBack,
}: Readonly<ConfigureNotificationsProps>) {
  return (
    <div className="flex flex-col gap-8 mt-4">
      <div className="flex flex-col gap-1.5 pb-2">
        <p className="text-sm text-text-secondary">
          Optionally configure notification channels to receive alerts about supplier activity,
          remediations, and delegator syncs.
        </p>
        <p className="text-[11px] text-text-tertiary">
          This step is optional — you can skip it and configure notifications later in Settings.
        </p>
      </div>

      <NotificationChannelsSection />

      {goNext && goBack && (
        <div className="flex justify-end gap-4 pt-2">
          <Button variant="outline" onClick={goBack}>
            Back
          </Button>
          <Button onClick={goNext}>Next</Button>
        </div>
      )}
    </div>
  )
}
