'use client'

import React from 'react'
import { Button } from '@igniter/ui/components/button'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CountMigratableHistory, MigrateRemediationHistory } from '@/actions/Transactions'

export default function MigrateHistoryButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<number | null>(null)

  const { data: migratableCount, isLoading, error: queryError } = useQuery({
    queryKey: ['migratable-history-count'],
    queryFn: async () => {
      const res = await CountMigratableHistory()
      if (!res.success) throw new Error(res.error.message)
      return res.data
    },
  })

  // Nothing to migrate
  if (!isLoading && !queryError && (migratableCount === 0 || migratableCount === undefined)) {
    return null
  }

  // Loading state
  if (isLoading) {
    return null
  }

  // Query failed — show error so it's not silent
  if (queryError) {
    return (
      <Button variant="outline" className="border-red-500/50 text-red-400" disabled title={queryError.message}>
        Migration check failed: {queryError.message}
      </Button>
    )
  }

  const handleConfirm = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const res = await MigrateRemediationHistory()
      if (!res.success) {
        setError(res.error.message)
        return
      }
      setResult(res.data)
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      await queryClient.invalidateQueries({ queryKey: ['migratable-history-count'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Migration failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
        onClick={() => { setOpen(true); setResult(null); setError(null) }}
      >
        Migrate History ({migratableCount} entries)
      </Button>

      <ConfirmationDialog
        title="Migrate Remediation History"
        open={open}
        onClose={() => { if (!isSubmitting) setOpen(false) }}
        footerActions={
          result !== null ? (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? 'Migrating...' : 'Migrate'}
              </Button>
            </>
          )
        }
      >
        {error && (
          <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root">
            {error}
          </div>
        )}
        {result !== null ? (
          <div className="py-3 text-[14px] text-text-secondary">
            Successfully migrated <span className="font-semibold text-emerald-400">{result}</span> transaction{result !== 1 ? 's' : ''} from remediation history.
          </div>
        ) : (
          <div className="py-3 text-[14px] text-text-secondary">
            <p>
              Found <span className="font-semibold">{migratableCount}</span> transaction{migratableCount !== 1 ? 's' : ''} stored
              in key remediation history that can be migrated to the transactions table.
            </p>
            <p className="mt-2 text-[12px] text-text-tertiary">
              This will move the entries into the transactions table and clean them from the key records.
              The operation runs in a database transaction — if anything fails, no changes are made.
            </p>
          </div>
        )}
      </ConfirmationDialog>
    </>
  )
}
