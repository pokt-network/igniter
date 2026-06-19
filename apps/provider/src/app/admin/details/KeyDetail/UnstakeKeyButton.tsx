'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ActionButton } from './ActionButton'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { Button } from '@igniter/ui/components/button'
import { Checkbox } from '@igniter/ui/components/checkbox'
import { UnstakeKeys } from '@/actions/Unstake'
import { type ReturnFundsInput } from '@/lib/unstakeValidation'
import { GetApplicationSettings } from '@/actions/ApplicationSettings'

interface UnstakeKeyButtonProps {
  keyId: number
  address: string
  returnFundsDefault?: boolean
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function UnstakeKeyButton({ keyId, address, returnFundsDefault }: UnstakeKeyButtonProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<Status>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [ack, setAck] = React.useState(false)
  const [rfMode, setRfMode] = React.useState<'none' | 'owner' | 'custom' | null>(null)
  const [customAddr, setCustomAddr] = React.useState('')

  // Fetch the setting on demand (when the dialog opens) if not passed as prop
  const { data: settings } = useQuery({
    queryKey: ['app-settings-return-funds'],
    queryFn: async () => {
      const s = await GetApplicationSettings()
      return s?.returnSupplierFundsToOwner ?? false
    },
    enabled: open && returnFundsDefault === undefined,
    staleTime: 60_000,
  })

  const effectiveDefault = returnFundsDefault !== undefined ? returnFundsDefault : (settings ?? false)

  // Initialise rfMode once we know the effective default
  React.useEffect(() => {
    if (open && rfMode === null) {
      setRfMode(effectiveDefault ? 'owner' : 'none')
    }
  }, [open, rfMode, effectiveDefault])

  const resolvedRfMode = rfMode ?? 'none'

  const handleOpen = () => {
    setStatus('idle')
    setError(null)
    setAck(false)
    setRfMode(null) // will be set by effect once effectiveDefault is known
    setCustomAddr('')
    setOpen(true)
  }

  const close = () => {
    if (status === 'submitting') return
    if (status === 'success') router.refresh()
    setOpen(false)
    setStatus('idle')
    setError(null)
    setAck(false)
  }

  const confirm = async () => {
    const returnFunds: ReturnFundsInput =
      resolvedRfMode === 'none' ? { mode: 'none' } : resolvedRfMode === 'owner' ? { mode: 'owner' } : { mode: 'custom', address: customAddr }
    setStatus('submitting')
    setError(null)
    const r = await UnstakeKeys({ filters: { keyIds: [keyId] }, returnFunds })
    if (!r.success) { setError(r.error.message); setStatus('error'); return }
    setStatus('success')
  }

  const canConfirm = ack && status !== 'submitting' && !(resolvedRfMode === 'custom' && !customAddr.trim())

  const footerActions = status === 'success' ? (
    <Button onClick={close}>Close</Button>
  ) : (
    <>
      <Button variant="outline" onClick={close} disabled={status === 'submitting'} type="button">
        Cancel
      </Button>
      <Button onClick={confirm} disabled={!canConfirm}>
        {status === 'submitting' ? 'Scheduling…' : 'Unstake'}
      </Button>
    </>
  )

  return (
    <>
      <ActionButton onClick={handleOpen}>Unstake</ActionButton>

      <ConfirmationDialog
        title="Unstake supplier"
        open={open}
        onClose={close}
        footerActions={footerActions}
      >
        {status === 'success' ? (
          <div className="flex flex-col gap-3 py-3 text-[14px]">
            <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/30 text-sm text-emerald-400">
              Unstake scheduled for <span className="font-mono">{address.slice(0, 10)}…{address.slice(-6)}</span>.
              {resolvedRfMode !== 'none' && ' Funds will be returned automatically once the unbonding period completes.'}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-3 text-[14px]">
            {status === 'error' && error && (
              <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root rounded-md">
                {error}
              </div>
            )}

            {/* Return funds tri-state */}
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-secondary font-medium">Return operator funds</span>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={`rfMode-${keyId}`} value="none" checked={resolvedRfMode === 'none'} onChange={() => setRfMode('none')} />
                  Do not return funds
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={`rfMode-${keyId}`} value="owner" checked={resolvedRfMode === 'owner'} onChange={() => setRfMode('owner')} />
                  Return to owner address
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name={`rfMode-${keyId}`} value="custom" checked={resolvedRfMode === 'custom'} onChange={() => setRfMode('custom')} />
                  Return to custom address
                </label>
              </div>
              {resolvedRfMode === 'custom' && (
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-bg-root px-3 py-2 text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border"
                  placeholder="pokt1..."
                  value={customAddr}
                  onChange={(e) => setCustomAddr(e.target.value)}
                />
              )}
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} />
              I understand this unstakes the supplier and retires the key.
            </label>
          </div>
        )}
      </ConfirmationDialog>
    </>
  )
}
