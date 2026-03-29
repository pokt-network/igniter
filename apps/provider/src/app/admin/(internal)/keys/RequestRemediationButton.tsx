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
import { CountTransactions } from '@/actions/Transactions'

type State = 'idle' | 'evaluating' | 'summary' | 'confirming' | 'progress' | 'done' | 'error'

export default function RequestRemediationButton() {
  const router = useRouter()
  const [state, setState] = React.useState<State>('idle')
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<RemediationSummary | null>(null)
  const [txBaseline, setTxBaseline] = React.useState<number>(0)
  const [txCurrent, setTxCurrent] = React.useState<number>(0)
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  const expectedTotal = summary?.total ?? 0

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  React.useEffect(() => {
    return () => stopPolling()
  }, [])

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

  const startProgressPolling = (baseline: number, total: number) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const result = await CountTransactions()
        if (!result.success) return
        const newTxs = result.data - baseline
        setTxCurrent(newTxs)
        if (newTxs >= total) {
          stopPolling()
          setState('done')
        }
      } catch {
        // ignore poll errors
      }
    }, 3000)
  }

  const handleConfirm = async () => {
    if (!summary) return

    const allAddresses = Object.values(summary.byReason).flatMap((r) => r.addresses)
    if (allAddresses.length === 0) return

    setError(null)
    setState('confirming')

    try {
      // Snapshot current tx count as baseline
      const countResult = await CountTransactions()
      const baseline = countResult.success ? countResult.data : 0
      setTxBaseline(baseline)
      setTxCurrent(0)

      const result = await RequestRemediation(allAddresses)
      if (!result.success) {
        setError(result.error.message)
        setState('error')
        return
      }

      setState('progress')
      startProgressPolling(baseline, summary.total)
    } catch (e) {
      console.error('Failed to request remediation', e)
      setError(e instanceof Error ? e.message : 'Failed to request remediation.')
      setState('error')
    }
  }

  const handleClose = () => {
    if (state === 'evaluating' || state === 'confirming') return
    stopPolling()
    setOpen(false)
    setState('idle')
    setError(null)
    setSummary(null)
    setTxBaseline(0)
    setTxCurrent(0)
    if (state === 'done' || state === 'progress') {
      router.refresh()
    }
  }

  const isLoading = state === 'evaluating' || state === 'confirming'
  const hasResults = summary && summary.total > 0
  const noResults = summary && summary.total === 0
  const processed = Math.min(txCurrent, expectedTotal)
  const progressPct = expectedTotal > 0 ? (processed / expectedTotal) * 100 : 0

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={state === 'evaluating' || state === 'confirming' || state === 'progress'}
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
            {state === 'done' && (
              <Button onClick={handleClose} type="button">
                Done
              </Button>
            )}
            {state === 'progress' && (
              <Button variant="outline" onClick={handleClose} type="button">
                Close
              </Button>
            )}
            {(state === 'summary' || state === 'error') && hasResults && (
              <>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={isLoading}
                  type="button"
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={isLoading}>
                  {state === 'confirming' ? 'Requesting...' : 'Confirm'}
                </Button>
              </>
            )}
            {state === 'error' && !hasResults && (
              <Button variant="outline" onClick={handleClose} type="button">
                Close
              </Button>
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

        {state === 'summary' && hasResults && (
          <div className="py-3 text-[14px] text-text-secondary">
            <p className="font-semibold mb-2">Evaluation Results:</p>
            <ul className="list-disc pl-5 space-y-1">
              {Object.values(summary!.byReason).map((reason) => (
                <li key={reason.label}>
                  {reason.count} supplier{reason.count !== 1 ? 's' : ''} {reason.count !== 1 ? 'have' : 'has'} {reason.label}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Total: <span className="font-semibold">{summary!.total}</span> supplier{summary!.total !== 1 ? 's' : ''} need{summary!.total === 1 ? 's' : ''} remediation.
            </p>
            <p className="mt-2 text-[12px] text-text-tertiary">
              Would you like to proceed? This will mark them for remediation and trigger the remediation workflow.
            </p>
          </div>
        )}

        {state === 'confirming' && (
          <div className="py-3 text-[14px] text-text-secondary">
            Submitting remediation request...
          </div>
        )}

        {(state === 'progress' || state === 'done') && (
          <div className="py-4 text-[14px] text-text-secondary">
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium">
                {state === 'done' ? 'Remediation complete' : 'Processing transactions...'}
              </span>
              <span className="font-mono text-sm">
                {processed} / {expectedTotal}
              </span>
            </div>
            <div className="w-full h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${state === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {state === 'done' && (
              <p className="mt-3 text-[12px] text-emerald-400">
                All {expectedTotal} supplier{expectedTotal !== 1 ? 's' : ''} have been processed.
              </p>
            )}
          </div>
        )}
      </ConfirmationDialog>
    </>
  )
}
