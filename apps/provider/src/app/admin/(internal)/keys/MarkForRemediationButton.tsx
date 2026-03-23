"use client";

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { useRouter } from 'next/navigation'
import { MarkKeysForRemediation } from '@/actions/Keys'

export default function MarkForRemediationButton() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onClick = () => setOpen(true)

  const onClose = () => {
    if (!isSubmitting) setOpen(false)
  }

  const handleConfirm = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      await MarkKeysForRemediation()
      setOpen(false)
      router.refresh()
    } catch (e) {
      console.error('Failed to mark keys for remediation', e)
      setError(e instanceof Error ? e.message : 'Failed to update keys state. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button className={'h-8'} variant={'outline'} onClick={onClick} disabled={isSubmitting}>
        Mark for remediation
      </Button>

      <ConfirmationDialog
        title="Mark for remediation"
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
          This will set all keys with state <span className="font-semibold">AttentionNeeded</span> or <span className="font-semibold">RemediationFailed</span> back to <span className="font-semibold">Staked</span>. The system will re-evaluate and try to remediate where possible.
        </div>
      </ConfirmationDialog>
    </>
  )
}
