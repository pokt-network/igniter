'use client'

import { useCallback, useState } from 'react'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import type { TransactionMessage } from '@igniter/ui/models'
import { BroadcastSignedTx, GetTxInclusion } from '@/actions/Staking'
import { assertDelegatorIsSigner } from '@/lib/staking/messages'
import { humanizeChainError } from '@/lib/staking/errors'

export type StageStatus = 'idle' | 'running' | 'success' | 'failure'

export interface StakingTxState {
  sign: StageStatus
  broadcast: StageStatus
  confirm: StageStatus
  hash?: string
  error?: string
}

const IDLE: StakingTxState = { sign: 'idle', broadcast: 'idle', confirm: 'idle' }
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 90_000

/**
 * Sign in wallet → broadcast via REST → poll inclusion. No DB row, no Temporal:
 * validator delegations are a convenience path, the explorer is the source of truth.
 */
export function useStakingTx() {
  const { signTransaction } = useWalletConnection()
  const [state, setState] = useState<StakingTxState>(IDLE)

  const reset = useCallback(() => setState(IDLE), [])

  const run = useCallback(
    async (messages: TransactionMessage[], signer: string): Promise<boolean> => {
      setState({ ...IDLE, sign: 'running' })
      let signedPayload: string
      try {
        assertDelegatorIsSigner(messages, signer)
        const signed = await signTransaction(messages, signer, undefined)
        signedPayload = signed.signedPayload
      } catch (err) {
        // Gas simulation runs inside the wallet's sign step, so a chain-level
        // rejection (redelegation still maturing, insufficient funds) surfaces
        // here rather than at broadcast.
        setState({
          ...IDLE,
          sign: 'failure',
          error: humanizeChainError((err as Error).message || 'Signature rejected'),
        })
        return false
      }

      setState({ ...IDLE, sign: 'success', broadcast: 'running' })
      let hash: string
      try {
        hash = (await BroadcastSignedTx(signedPayload)).hash
      } catch (err) {
        setState({ ...IDLE, sign: 'success', broadcast: 'failure', error: humanizeChainError((err as Error).message) })
        return false
      }

      setState({ sign: 'success', broadcast: 'success', confirm: 'running', hash })
      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        let inclusion
        try {
          inclusion = await GetTxInclusion(hash)
        } catch {
          continue
        }
        if (inclusion.status === 'success') {
          setState({ sign: 'success', broadcast: 'success', confirm: 'success', hash })
          return true
        }
        if (inclusion.status === 'failure') {
          setState({
            sign: 'success',
            broadcast: 'success',
            confirm: 'failure',
            hash,
            error: inclusion.rawLog
              ? humanizeChainError(inclusion.rawLog)
              : `Transaction failed with code ${inclusion.code}`,
          })
          return false
        }
      }
      setState({
        sign: 'success',
        broadcast: 'success',
        confirm: 'failure',
        hash,
        error: 'Timed out waiting for inclusion. Check the transaction hash in the explorer.',
      })
      return false
    },
    [signTransaction],
  )

  return { state, run, reset }
}
