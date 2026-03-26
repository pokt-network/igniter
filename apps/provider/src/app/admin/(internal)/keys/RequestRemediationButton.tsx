"use client";

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { useRouter } from 'next/navigation'
import {
  EvaluateRemediationNeeds,
  RequestRemediation,
  type RemediationSummary,
} from '@/actions/Remediation'

type State = 'idle' | 'evaluating' | 'summary' | 'confirming' | 'done' | 'error'

export default function RequestRemediationButton() {
  const router = useRouter()
  const [state, setState] = React.useState<State>('idle')
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<RemediationSummary | null>(null)

  const handleClick = async () => {
    setError(null)
    setSummary(null)
    setOpen(true)
    setState('evaluating')

    try {
      const result = await EvaluateRemediationNeeds()
      if (!result.success) {
        setError(result.error.message)
        setState('error')
        return
      }
      setSummary(result.data)
      setState('summary')
    } catch (e) {
      console.error('Failed to evaluate remediation needs', e)
      setError(e instanceof Error ? e.message : 'Failed to evaluate remediation needs.')
      setState('error')
    }
  }

  const handleConfirm = async () => {
    if (!summary) return

    const allAddresses = Object.values(summary.byReason).flatMap((r) => r.addresses)
    if (allAddresses.length === 0) return

    setError(null)
    setState('confirming')

    try {
      const result = await RequestRemediation(allAddresses)
      if (!result.success) {
        setError(result.error.message)
        setState('error')
        return
      }
      setState('done')
      setOpen(false)
      router.refresh()
    } catch (e) {
      console.error('Failed to request remediation', e)
      setError(e instanceof Error ? e.message : 'Failed to request remediation.')
      setState('error')
    }
  }

  const handleClose = () => {
    if (state === 'evaluating' || state === 'confirming') return
    setOpen(false)
    setState('idle')
    setError(null)
    setSummary(null)
  }

  const isLoading = state === 'evaluating' || state === 'confirming'
  const hasResults = summary && summary.total > 0
  const noResults = summary && summary.total === 0

  return (
    <>
      <Button
        className={'h-8'}
        variant={'outline'}
        onClick={handleClick}
        disabled={state === 'evaluating' || state === 'confirming'}
      >
        Request Remediation
      </Button>

      <ConfirmationDialog
        title="Request Remediation"
        open={open}
        onClose={handleClose}
        footerActions={(
          <>
            {noResults && (
              <Button variant="outline" onClick={handleClose} type="button">
                Close
              </Button>
            )}
            {(hasResults || state === 'error') && (
              <>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={isLoading}
                  type="button"
                >
                  Cancel
                </Button>
                {hasResults && (
                  <Button onClick={handleConfirm} disabled={isLoading}>
                    {state === 'confirming' ? 'Requesting...' : 'Confirm'}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      >
        {error && (
          <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root">
            {error}
          </div>
        )}

        {state === 'evaluating' && (
          <div className="py-3 text-[14px] text-text-secondary">
            Evaluating supplier configurations...
          </div>
        )}

        {noResults && (
          <div className="py-3 text-[14px] text-text-secondary">
            All suppliers are up to date. No remediation needed.
          </div>
        )}

        {hasResults && (
          <div className="py-3 text-[14px] text-text-secondary">
            <p className="font-semibold mb-2">Evaluation Results:</p>
            <ul className="list-disc pl-5 space-y-1">
              {Object.values(summary.byReason).map((reason) => (
                <li key={reason.label}>
                  {reason.count} supplier{reason.count !== 1 ? 's' : ''} {reason.count !== 1 ? 'have' : 'has'} {reason.label}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Total: <span className="font-semibold">{summary.total}</span> supplier{summary.total !== 1 ? 's' : ''} need{summary.total === 1 ? 's' : ''} remediation.
            </p>
            <p className="mt-2 text-[12px] text-text-tertiary">
              Would you like to proceed? This will mark them for remediation and trigger the remediation workflow.
            </p>
          </div>
        )}
      </ConfirmationDialog>
    </>
  )
}
