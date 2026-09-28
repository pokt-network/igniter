'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@igniter/ui/components/dialog'
import { Button } from '@igniter/ui/components/button'
import { Input } from '@igniter/ui/components/input'
import { CheckSuccess, LoaderIcon, XIcon } from '@igniter/ui/assets'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import type { TransactionMessage } from '@igniter/ui/models'
import { amountToPokt, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { poktToUpokt } from '@/lib/staking/messages'
import { useStakingTx, type StageStatus } from './useStakingTx'

export interface StakingActionDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: React.ReactNode
  signer: string
  /** When set, an amount input is shown and its upokt value is passed to buildMessages. */
  amount?: {
    label: string
    /** upokt cap shown as "Max" and enforced client-side */
    maxUpokt?: string
  }
  buildMessages: (upokt?: string) => TransactionMessage[]
  /** Called once inclusion is confirmed. */
  onSuccess: () => void
}

const STAGES: { key: 'sign' | 'broadcast' | 'confirm'; label: string }[] = [
  { key: 'sign', label: 'Sign transaction in wallet' },
  { key: 'broadcast', label: 'Broadcast to network' },
  { key: 'confirm', label: 'Confirm inclusion in block' },
]

function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'running') return <LoaderIcon className="animate-spin" />
  if (status === 'success') return <CheckSuccess />
  if (status === 'failure') return <XIcon />
  return <span className="inline-block w-4 h-4 rounded-full border border-border" />
}

export function StakingActionDialog({
  open,
  onClose,
  title,
  description,
  signer,
  amount,
  buildMessages,
  onSuccess,
}: Readonly<StakingActionDialogProps>) {
  const { state, run, reset } = useStakingTx()
  const [amountInput, setAmountInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const running = state.sign === 'running' || state.broadcast === 'running' || state.confirm === 'running'
  const finished = state.confirm === 'success'
  const failed = state.sign === 'failure' || state.broadcast === 'failure' || state.confirm === 'failure'
  const started = state.sign !== 'idle'

  useEffect(() => {
    if (!open) {
      reset()
      setAmountInput('')
      setInputError(null)
    }
  }, [open, reset])

  const maxPokt = useMemo(() => (amount?.maxUpokt ? amountToPokt(amount.maxUpokt) : undefined), [amount?.maxUpokt])

  async function submit() {
    let upokt: string | undefined
    if (amount) {
      try {
        upokt = poktToUpokt(amountInput)
      } catch (err) {
        setInputError((err as Error).message)
        return
      }
      if (amount.maxUpokt && BigInt(upokt) > BigInt(amount.maxUpokt)) {
        setInputError(`Amount exceeds available ${toCurrencyFormat(maxPokt!, 6, 0)} POKT`)
        return
      }
    }
    setInputError(null)
    const ok = await run(buildMessages(upokt), signer)
    if (ok) onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !running) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{title}</DialogTitle>
        {description && <div className="text-sm text-text-secondary">{description}</div>}

        {amount && !started && (
          <div className="flex flex-col gap-2">
            <label className="text-sm">{amount.label}</label>
            <div className="flex gap-2 items-center">
              <Input
                inputMode="decimal"
                placeholder="0.000000"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              {maxPokt !== undefined && (
                <Button variant="secondary" onClick={() => setAmountInput(String(maxPokt))}>Max</Button>
              )}
            </div>
            {maxPokt !== undefined && (
              <span className="text-xs text-text-tertiary">Available: {toCurrencyFormat(maxPokt, 6, 0)} POKT</span>
            )}
            {inputError && <span className="text-xs text-red-500">{inputError}</span>}
          </div>
        )}

        {started && (
          <div className="flex flex-col gap-3 py-2">
            {STAGES.map((s) => (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                <StageIcon status={state[s.key]} />
                <span>{s.label}</span>
              </div>
            ))}
            {state.hash && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">Hash:</span>
                <TransactionHash hash={state.hash} />
              </div>
            )}
            {state.error && <p className="text-xs text-red-500 break-words">{state.error}</p>}
          </div>
        )}

        <DialogFooter>
          {!started && (
            <>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={submit}>Confirm</Button>
            </>
          )}
          {started && (finished || failed) && <Button onClick={onClose}>Close</Button>}
          {started && running && <Button disabled>Working…</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
