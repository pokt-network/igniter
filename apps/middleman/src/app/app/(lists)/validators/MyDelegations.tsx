'use client'

import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@igniter/ui/components/button'
import Address from '@igniter/ui/components/Address'
import Amount from '@igniter/ui/components/Amount'
import { Skeleton } from '@igniter/ui/components/skeleton'
import NoData from '@igniter/ui/components/NoData'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { useApplicationSettings } from '@/app/context/ApplicationSettings'
import { amountToPokt } from '@igniter/ui/lib/utils'
import { GetDelegatorState, GetValidatorApr, GetValidators } from '@/actions/Staking'
import { formatDuration } from '@/lib/utils/time'
import {
  buildRedelegateMessage,
  buildUndelegateMessage,
  buildWithdrawRewardMessages,
} from '@/lib/staking/messages'
import { explorerAccountUrl, explorerValidatorUrl } from '@/lib/staking/explorer'
import { StakingActionDialog, type StakingActionDialogProps } from './StakingActionDialog'
import { toast } from 'sonner'

type PendingAction = Omit<StakingActionDialogProps, 'open' | 'onClose' | 'signer' | 'onSuccess'>

const REWARDS_WINDOW = 30

function sumUpokt(values: string[]): number {
  return amountToPokt(values.reduce((acc, v) => acc + BigInt(v), 0n).toString())
}

export default function MyDelegations() {
  const { connectedIdentity } = useWalletConnection()
  const settings = useApplicationSettings()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<PendingAction | null>(null)
  const [redelegateFrom, setRedelegateFrom] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['delegator-state', connectedIdentity],
    queryFn: () => GetDelegatorState(connectedIdentity!),
    enabled: Boolean(connectedIdentity),
    refetchInterval: 30_000,
  })

  const { data: validators } = useQuery({ queryKey: ['validators'], queryFn: GetValidators })
  const { data: apr } = useQuery({ queryKey: ['validator-apr'], queryFn: GetValidatorApr, staleTime: 10 * 60_000 })

  const monikerOf = useMemo(() => {
    const m = new Map<string, string>()
    validators?.forEach((v) => m.set(v.operatorAddress, v.moniker))
    return (addr: string) => m.get(addr) ?? addr
  }, [validators])

  if (!connectedIdentity) {
    return <NoData label="Connect a wallet to see your delegations." />
  }

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-red-500">Failed to load delegations.</span>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    )
  }

  const totalStaked = sumUpokt(data.delegations.map((d) => d.amount))
  const totalUnbonding = sumUpokt(data.unbonding.map((u) => u.amount))
  const claimableTotal = sumUpokt(data.rewards.map((r) => r.amount))
  const rewardValidators = data.rewards.map((r) => r.validatorAddress)
  const myAccountUrl = explorerAccountUrl(settings?.chainId, connectedIdentity)

  // Refresh on close as well as on confirmation: the REST node can still be a
  // block behind at the moment inclusion is confirmed, so the first refetch may
  // read pre-transaction state.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['delegator-state', connectedIdentity] })
    queryClient.invalidateQueries({ queryKey: ['balance', connectedIdentity] })
  }

  const onSuccess = (msg: string) => () => {
    toast.success(msg)
    refresh()
  }

  const aprOf = (validatorAddress: string): number | undefined =>
    apr?.byValidator[validatorAddress]?.[REWARDS_WINDOW]?.delegatorAprPct

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Stat label="Delegated" value={totalStaked} />
        <Stat label="Unbonding" value={totalUnbonding} />
      </div>

      {/* Settlement income credits the wallet directly, so it never shows up here.
          What the distribution module holds is dust by comparison — still withdrawable,
          so the claim stays available, just not as a headline number. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
        <span>
          Rewards are paid directly to your wallet balance as claims settle.{' '}
          {myAccountUrl ? (
            <a className="text-accent underline-offset-4 hover:underline" href={myAccountUrl} target="_blank" rel="noreferrer">
              View your account in the explorer
            </a>
          ) : (
            'Check your address in the explorer'
          )}{' '}
          for the full history.
        </span>
        {claimableTotal > 0 && (
          <span className="flex items-center gap-2">
            <span className="text-text-secondary">
              Claimable here: <Amount value={claimableTotal} maxFractionDigits={6} minimumFractionDigits={0} />
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setAction({
                  title: 'Claim all rewards',
                  description: `Withdraw from ${rewardValidators.length} validator(s). These are distribution-module rewards, separate from settlement income already in your balance.`,
                  buildMessages: () => buildWithdrawRewardMessages(connectedIdentity, rewardValidators),
                })
              }
            >
              Claim all
            </Button>
          </span>
        )}
      </div>

      {data.delegations.length === 0 ? (
        <NoData label="No delegations yet. Pick a validator below to delegate." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="text-text-secondary text-left">
              <tr>
                <th className="p-3">Validator</th>
                <th className="p-3">Delegated</th>
                {apr && <th className="p-3">APR {REWARDS_WINDOW}d</th>}
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.delegations.map((d) => {
                const validatorApr = aprOf(d.validatorAddress)
                return (
                  <tr key={d.validatorAddress} className="border-t border-border">
                    <td className="p-3">
                      <div className="flex flex-col">
                        <ValidatorName
                          moniker={monikerOf(d.validatorAddress)}
                          url={explorerValidatorUrl(settings?.chainId, d.validatorAddress)}
                        />
                        <Address address={d.validatorAddress} />
                      </div>
                    </td>
                    <td className="p-3"><Amount value={amountToPokt(d.amount)} /></td>
                    {apr && (
                      <td className="p-3 font-mono">
                        {validatorApr !== undefined ? `${validatorApr.toFixed(2)}%` : '—'}
                      </td>
                    )}
                    <td className="p-3">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setRedelegateFrom(d.validatorAddress)}>
                          Redelegate
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setAction({
                              title: `Undelegate from ${monikerOf(d.validatorAddress)}`,
                              description: 'Tokens enter the unbonding period and stop earning rewards until released.',
                              amount: { label: 'Amount (POKT)', maxUpokt: d.amount },
                              buildMessages: (upokt) => [buildUndelegateMessage(connectedIdentity, d.validatorAddress, upokt!)],
                            })
                          }
                        >
                          Undelegate
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.unbonding.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-text-secondary">Unbonding</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-text-secondary text-left">
                <tr>
                  <th className="p-3">Validator</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Releases in</th>
                </tr>
              </thead>
              <tbody>
                {data.unbonding.map((u, i) => {
                  const secondsLeft = Math.max(0, (new Date(u.completionTime).getTime() - Date.now()) / 1000)
                  return (
                    <tr key={`${u.validatorAddress}-${i}`} className="border-t border-border">
                      <td className="p-3">
                        <div className="flex flex-col">
                          <span className="font-medium">{monikerOf(u.validatorAddress)}</span>
                          <Address address={u.validatorAddress} />
                        </div>
                      </td>
                      <td className="p-3"><Amount value={amountToPokt(u.amount)} /></td>
                      <td className="p-3 font-mono">{formatDuration(secondsLeft)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {action && (
        <StakingActionDialog
          open
          onClose={() => {
            setAction(null)
            refresh()
          }}
          signer={connectedIdentity}
          onSuccess={onSuccess('Transaction confirmed')}
          {...action}
        />
      )}

      {redelegateFrom && (
        <RedelegatePicker
          from={redelegateFrom}
          maxUpokt={data.delegations.find((d) => d.validatorAddress === redelegateFrom)?.amount ?? '0'}
          validators={(validators ?? []).filter(
            (v) => v.operatorAddress !== redelegateFrom && v.status === 'bonded' && !v.jailed,
          )}
          monikerOf={monikerOf}
          signer={connectedIdentity}
          onClose={() => {
            setRedelegateFrom(null)
            refresh()
          }}
          onSuccess={onSuccess('Redelegation confirmed')}
        />
      )}
    </div>
  )
}

function ValidatorName({ moniker, url }: { moniker: string; url: string | null }) {
  if (!url) return <span className="font-medium">{moniker}</span>
  return (
    <a className="font-medium hover:underline underline-offset-4" href={url} target="_blank" rel="noreferrer">
      {moniker}
    </a>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-lg"><Amount value={value} /></span>
    </div>
  )
}

function RedelegatePicker({
  from,
  maxUpokt,
  validators,
  monikerOf,
  signer,
  onClose,
  onSuccess,
}: {
  from: string
  maxUpokt: string
  validators: { operatorAddress: string; moniker: string }[]
  monikerOf: (addr: string) => string
  signer: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [to, setTo] = useState<string>(validators[0]?.operatorAddress ?? '')

  return (
    <StakingActionDialog
      open
      onClose={onClose}
      signer={signer}
      onSuccess={onSuccess}
      title={`Redelegate from ${monikerOf(from)}`}
      description={
        <div className="flex flex-col gap-2 pt-2">
          <label className="text-sm">Destination validator</label>
          <select
            className="rounded-md border border-border bg-transparent p-2 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {validators.map((v) => (
              <option key={v.operatorAddress} value={v.operatorAddress}>{v.moniker}</option>
            ))}
          </select>
        </div>
      }
      amount={{ label: 'Amount (POKT)', maxUpokt }}
      buildMessages={(upokt) => [buildRedelegateMessage(signer, from, to, upokt!)]}
    />
  )
}
