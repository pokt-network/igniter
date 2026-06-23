'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionButton } from './ActionButton'
import { ConfirmationDialog } from '@/components/ConfirmationDialog'
import { Button } from '@igniter/ui/components/button'
import { Checkbox } from '@igniter/ui/components/checkbox'
import Summary, { type SummaryRow } from '@igniter/ui/components/Summary'
import Address from '@igniter/ui/components/Address'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import { amountToPokt, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { UnstakeKeys, GetUnstakeDuration } from '@/actions/Unstake'
import { type ReturnFundsInput } from '@/lib/unstakeValidation'
import { GetApplicationSettings } from '@/actions/ApplicationSettings'
import { formatDuration } from '@/lib/utils/time'

interface UnstakeKeyButtonProps {
  keyId: number
  address: string
  returnFundsDefault?: boolean
  stakeAmountUpokt?: bigint | number | null
  balanceUpokt?: bigint | number | null
  stakeOwner?: string | null
  ownerAddress?: string | null
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function UnstakeKeyButton({
  keyId,
  address,
  returnFundsDefault,
  stakeAmountUpokt,
  balanceUpokt,
  stakeOwner,
  ownerAddress,
}: UnstakeKeyButtonProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
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

  // Estimated unbonding duration (display-only; null when indexer is not configured).
  const { data: durationData, isLoading: isLoadingDuration } = useQuery({
    queryKey: ['provider-unstake-duration'],
    queryFn: GetUnstakeDuration,
    enabled: open,
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
    queryClient.invalidateQueries({ queryKey: ['keys-pending-unstake'] })
    queryClient.invalidateQueries({ queryKey: ['keys-pending-state'] })
    queryClient.invalidateQueries({ queryKey: ['keys'] })
  }

  const canConfirm = ack && status !== 'submitting' && !(resolvedRfMode === 'custom' && !customAddr.trim())

  const stakePokt = toCurrencyFormat(amountToPokt(Number(stakeAmountUpokt ?? 0)), 2, 2)
  const residualPokt = toCurrencyFormat(amountToPokt(Number(balanceUpokt ?? 0)), 2, 2)
  const returnsFunds = resolvedRfMode !== 'none'
  const formattedDuration = durationData ? formatDuration(durationData.durationSeconds) : null

  const returnFundsLabel =
    resolvedRfMode === 'none' ? 'None' : resolvedRfMode === 'owner' ? 'To owner' : 'To custom address'

  // Pre-confirm review rows: identity → amounts → policy → duration.
  // NOTE: amount values are kept in normal primary text — color is never used to
  // distinguish the residual policy; the label carries that meaning instead.
  const reviewRows: Array<SummaryRow> = [
    {
      label: 'Supplier',
      value: <Address address={address} />,
    },
    {
      label: 'Tokens to Receive',
      value: (
        <span className="flex flex-row gap-2">
          <span className="font-mono text-[14px] text-text-primary">{stakePokt}</span>
          <span className="font-mono text-[14px] text-text-tertiary">$POKT</span>
        </span>
      ),
    },
    {
      label: (
        <span className="flex flex-row items-center gap-2">
          <span>{returnsFunds ? 'Returned to Owner' : 'Stays with Operator'}</span>
          <QuickInfoPopOverIcon
            title={returnsFunds ? 'Funds returned to owner' : 'Funds not returned'}
            description={returnsFunds
              ? "Returns the supplier's remaining account balance (minus network fees) to the owner once the unstake is confirmed."
              : "Funds are not returned. The supplier's remaining balance (minus the unstake fee) stays with the operator address."}
            url=""
          />
        </span>
      ),
      value: (
        <span className="flex flex-row gap-2">
          <span className="font-mono text-[14px] text-text-primary">Approx. {residualPokt}</span>
          <span className="font-mono text-[14px] text-text-tertiary">$POKT</span>
        </span>
      ),
    },
    {
      label: (
        <span className="flex flex-row items-center gap-2">
          <span>Unstake in</span>
          <QuickInfoPopOverIcon
            title="How the unstake duration is calculated"
            description="Estimated from the number of blocks per session, the supplier's unbonding period in sessions, and the average block time measured over the last 30 days of block data. Once confirmed, your tokens are returned to the owner address."
            url=""
          />
        </span>
      ),
      value: isLoadingDuration ? (
        <span className="font-mono text-[14px] text-text-tertiary">…</span>
      ) : (
        <span className={`font-mono text-[14px] ${formattedDuration ? 'text-text-primary' : 'text-yellow-400'}`}>
          {formattedDuration ?? 'N/A'}
        </span>
      ),
    },
  ]

  const successRows: Array<SummaryRow> = [
    {
      label: 'Supplier',
      value: <Address address={address} />,
    },
    {
      label: 'Tokens to Receive',
      value: (
        <span className="flex flex-row gap-2">
          <span className="font-mono text-[14px] text-text-primary">{stakePokt}</span>
          <span className="font-mono text-[14px] text-text-tertiary">$POKT</span>
        </span>
      ),
    },
    {
      label: 'Return funds',
      value: <span className="text-[14px] text-text-primary">{returnFundsLabel}</span>,
    },
  ]

  const footerActions = status === 'success' ? (
    <Button onClick={close}>Close</Button>
  ) : (
    <>
      <Button variant="outline" onClick={close} disabled={status === 'submitting'} type="button">
        Cancel
      </Button>
      <Button onClick={confirm} disabled={!canConfirm} className="bg-red-600 text-white border-transparent hover:bg-red-700">
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
          <div className="flex flex-col gap-4 py-3 text-[14px]">
            {/* Hero */}
            <div className="relative flex h-[64px] gradient-border-green">
              <div className="absolute inset-0 flex flex-row items-center m-[0.5px] bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
                <span className="text-[20px] text-text-primary">Unstake</span>
                <span className="flex flex-row items-center gap-2">
                  <span className="font-mono text-[20px] text-text-primary">{stakePokt}</span>
                  <span className="font-mono text-[20px] text-text-tertiary">$POKT</span>
                </span>
              </div>
            </div>

            <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
              <span className="text-[14px] text-text-secondary p-[11px_16px]">
                The supplier is being unstaked and will enter an unbonding period. After the
                unbonding period completes, the staked tokens automatically return to the owner address.
                {returnsFunds && ' The operator’s remaining funds are returned automatically once the unstake is confirmed.'}
              </span>
            </div>

            <Summary rows={successRows} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-3 text-[14px]">
            {status === 'error' && error && (
              <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root rounded-md">
                {error}
              </div>
            )}

            {/* Pre-confirm review summary */}
            <Summary rows={reviewRows} />

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

            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-400">
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} />
              I understand this unstakes the supplier and retires the key.
            </label>
          </div>
        )}
      </ConfirmationDialog>
    </>
  )
}
