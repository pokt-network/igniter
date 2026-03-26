"use client";

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { GetRemediationScheduleStatus, ToggleRemediationSchedule } from '@/actions/Schedules'

export default function AutoStakeToggle() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['remediation-schedule-status'],
    queryFn: async () => {
      const result = await GetRemediationScheduleStatus()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    refetchInterval: 30000,
  })

  const paused = data?.paused ?? false

  const onClick = () => setOpen(true)

  const onClose = () => {
    if (!isSubmitting) setOpen(false)
  }

  const handleConfirm = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await ToggleRemediationSchedule(!paused)
      if (!result.success) {
        setError(result.error.message)
        return
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      console.error('Failed to toggle remediation schedule', e)
      setError(e instanceof Error ? e.message : 'Failed to toggle schedule. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <Button className={'h-8'} variant={'outline'} disabled>
        Auto Stake: …
      </Button>
    )
  }

  return (
    <>
      <Button className={'h-8'} variant={'outline'} onClick={onClick} disabled={isSubmitting}>
        Auto Stake: {paused ? 'OFF' : 'ON'}
      </Button>

      <ConfirmationDialog
        title={paused ? 'Enable Auto Stake' : 'Disable Auto Stake'}
        open={open}
        onClose={onClose}
        footerActions={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting} type="button">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? 'Confirming…' : 'Confirm'}
            </Button>
          </>
        )}
      >
        {error && (
          <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root">
            {error}
          </div>
        )}
        <div className="py-3 text-[14px] text-text-secondary">
          {paused ? (
            <>
              This will <span className="font-semibold">resume</span> the automatic remediation schedule. The system will automatically re-stake suppliers with service mismatches on the configured interval.
            </>
          ) : (
            <>
              This will <span className="font-semibold">pause</span> the automatic remediation schedule. Suppliers with service mismatches will no longer be automatically re-staked until you re-enable this.
            </>
          )}
        </div>
      </ConfirmationDialog>
    </>
  )
}
