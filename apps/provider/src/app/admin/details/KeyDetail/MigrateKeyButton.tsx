'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ActionButton } from '@/app/admin/details/KeyDetail/ActionButton'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { Button } from '@igniter/ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import { ListBasicAddressGroups } from '@/actions/AddressGroups'
import { MigrateKeysToAddressGroup } from '@/actions/Keys'

interface MigrateKeyButtonProps {
  keyId: number
  currentGroupId: number | null
  currentGroupName: string | null
}

export function MigrateKeyButton({ keyId, currentGroupId, currentGroupName }: MigrateKeyButtonProps) {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [targetGroupId, setTargetGroupId] = React.useState('')

  const { data: addressGroups = [] } = useQuery({
    queryKey: ['basic-address-groups'],
    queryFn: async () => {
      const result = await ListBasicAddressGroups()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: showConfirm,
    staleTime: 30_000,
  })

  const availableGroups = addressGroups.filter((g) => g.id !== currentGroupId)

  const handleOpen = () => {
    setTargetGroupId('')
    setError(null)
    setShowConfirm(true)
  }

  const handleConfirm = async () => {
    if (!targetGroupId) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await MigrateKeysToAddressGroup({ keyIds: [keyId] }, Number(targetGroupId))
      if (!result.success) throw new Error(result.error.message)
      setShowConfirm(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to migrate key. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <ActionButton onClick={handleOpen}>
        Migrate to group
      </ActionButton>

      <ConfirmationDialog
        title="Migrate to group"
        open={showConfirm}
        onClose={() => { if (!isSubmitting) setShowConfirm(false) }}
        footerActions={(
          <>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting} type="button">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || !targetGroupId}>
              {isSubmitting ? 'Migrating…' : 'Migrate'}
            </Button>
          </>
        )}
      >
        {error && (
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
      </ConfirmationDialog>
    </>
  )
}