'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ActionButton } from '@/app/admin/details/KeyDetail/ActionButton'
import { ConfirmationDialog } from '@igniter/ui/components/ConfirmationDialog'
import { Button } from '@igniter/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { ListBasicAddressGroups } from '@/actions/AddressGroups'
import { MigrateKeysToAddressGroup } from '@/actions/Keys'

interface MigrateKeyButtonProps {
  keyId: number
  currentGroupId: number | null
  currentGroupName: string | null
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function MigrateKeyButton({ keyId, currentGroupId, currentGroupName }: MigrateKeyButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<Status>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [targetGroupId, setTargetGroupId] = React.useState('')

  const { data: addressGroups = [] } = useQuery({
    queryKey: ['basic-address-groups'],
    queryFn: async () => {
      const result = await ListBasicAddressGroups()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: open,
    staleTime: 30_000,
  })

  const availableGroups = addressGroups.filter((g) => g.id !== currentGroupId)
  const targetGroup = addressGroups.find((g) => g.id === Number(targetGroupId))

  const handleOpen = () => {
    setTargetGroupId('')
    setError(null)
    setStatus('idle')
    setOpen(true)
  }

  const handleClose = () => {
    if (status === 'submitting') return
    if (status === 'success') router.refresh()
    setOpen(false)
  }

  const handleConfirm = async () => {
    if (!targetGroupId) return
    setError(null)
    setStatus('submitting')
    try {
      const result = await MigrateKeysToAddressGroup({ keyIds: [keyId] }, Number(targetGroupId))
      if (!result.success) throw new Error(result.error.message)
      setStatus('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to migrate key. Please try again.')
      setStatus('error')
    }
  }

  const footerActions = status === 'success' ? (
    <Button onClick={handleClose}>Close</Button>
  ) : (
    <>
      <Button variant="outline" onClick={handleClose} disabled={status === 'submitting'} type="button">
        Cancel
      </Button>
      <Button onClick={handleConfirm} disabled={status === 'submitting' || !targetGroupId}>
        {status === 'submitting' ? 'Migrating…' : 'Migrate'}
      </Button>
    </>
  )

  return (
    <>
      <ActionButton onClick={handleOpen}>
        Migrate to group
      </ActionButton>

      <ConfirmationDialog
        title="Migrate to group"
        open={open}
        onClose={handleClose}
        footerActions={footerActions}
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-3 py-3 text-[14px]">
            <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/30 text-sm text-emerald-400">
              Key successfully migrated to <span className="font-semibold">{targetGroup?.name}</span>. It has been queued for remediation.
            </div>
          </div>
        ) : (
          <>
            {status === 'error' && error && (
              <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-4 py-3 text-[14px]">
              {currentGroupName && (
                <div className="text-text-secondary">
                  Current group: <span className="font-semibold text-text-primary">{currentGroupName}</span>
                </div>
              )}
              <Select value={targetGroupId} onValueChange={setTargetGroupId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select target group" />
                </SelectTrigger>
                <SelectContent>
                  {availableGroups.map((group) => (
                    <SelectItem value={group.id.toString()} key={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetGroupId && (
                <p className="text-xs text-text-tertiary">
                  This key will be queued for remediation to match the new group&apos;s service configuration.
                </p>
              )}
            </div>
          </>
        )}
      </ConfirmationDialog>
    </>
  )
}