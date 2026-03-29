"use client";

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GetRemediationScheduleStatus, ToggleRemediationSchedule } from '@/actions/Schedules'

export default function AutoStakeToggle() {
  const router = useRouter()
  const queryClient = useQueryClient()
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
      await queryClient.invalidateQueries({ queryKey: ['remediation-schedule-status'] })
      setOpen(false)
    } catch (e) {
      console.error('Failed to toggle remediation schedule', e)
      setError(e instanceof Error ? e.message : 'Failed to toggle schedule. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isActive = !paused

  if (isLoading) {
    return (
      <button
        className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium border border-border-primary text-text-secondary opacity-50 cursor-default"
        disabled
      >
        <span className="h-2 w-2 rounded-full bg-text-secondary" />
        Auto Stake: …
      </button>
    )
  }

  return (
    <>
      <button
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
          isActive
            ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            : 'border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20'
        }`}
        onClick={onClick}
        disabled={isSubmitting}
      >
        <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]'}`} />
        Auto Stake: {isActive ? 'ON' : 'OFF'}
      </button>

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
