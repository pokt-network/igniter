"use client";

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import { useRouter } from 'next/navigation'
import { ClearKeysRemediation } from '@/actions/Keys'
import { getLogger } from '@igniter/logger';

const log = getLogger(['provider', 'ui', 'ClearRemediationButton']);

export default function ClearRemediationButton() {
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
      await ClearKeysRemediation()
      setOpen(false)
      router.refresh()
    } catch (e) {
      log.error('Failed to clear remediation state', { error: e })
      setError(e instanceof Error ? e.message : 'Failed to update keys state. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button className="border-red-500/50 text-red-400 hover:bg-red-500/10" variant="outline" onClick={onClick} disabled={isSubmitting}>
        Clear remediation
      </Button>

      <ConfirmationDialog
        title="Clear remediation"
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
          This will reset all keys with state <span className="font-semibold">AttentionNeeded</span> or <span className="font-semibold">RemediationFailed</span> back to <span className="font-semibold">Staked</span>. The system will re-evaluate them on the next status check.
        </div>
      </ConfirmationDialog>
    </>
  )
}
