'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import FourCard from '../FourCards/FourCard'
import { combineByIndex } from '../FourCards/utils'
import { labels } from './constants'
import NoData from '../NoData'
import { amountToPokt, toCurrencyFormat } from '../../lib/utils'
import { useHeightContext } from '../../context/Height/height'
import { rewardsWindowsDocument } from '@igniter/graphql/rewards'
import { summaryVariables } from './operations'
import { batchArray } from '../../lib/batch'
import useBlockRetry from '../../hooks/useBlockRetry'
import { coverageNote, isFailedTotal, Ranged } from '../../lib/range'
import { combineRewardsWindows, newerTotal, RewardsWindows } from '../../lib/rewards'

export type SuppliersSummary = { count: number; stakeUpokt: number }

// Suppliers and stake change on any stake or unstake, so they refresh from igniter's DB on a timer,
// as ProviderBreakdown's stakes (React Query: one fetch at a time, paused while the tab is hidden);
// rewards only change when claims settle.
const SUPPLIERS_REFRESH_MS = 60 * 1000

// The rewards totals normalised once (see range.ts); null: they could not be fetched. Rewards only
// change when claims settle, so they refresh on a new settlement height.
export type SummaryRewards = {
  [K in keyof RewardsWindows]: RewardsWindows[K] | null
}

function Value({value, tooltip, note, onRetry}: {value: string, tooltip?: string, note?: string | null, onRetry?: () => void}) {
  return (
    <p className={'mt-1 sm:text-lg font-medium'} title={tooltip}>
      {value}{tooltip && <span className="inline-block ml-1 text-xs text-text-tertiary cursor-help" title={tooltip}>&#9432;</span>}
      {onRetry && <button type="button" onClick={onRetry} className="ml-2 text-xs underline text-text-tertiary">Retry</button>}
      {note && <span className="block text-xs font-normal text-text-tertiary">{note}</span>}
    </p>
  )
}

// A rewards total (see range.ts). A missing total (failed fetch) and a window with nothing
// covered both show N/A, never 0; the indexer's range, when it sends one, adds a note on what is
// covered.
function rewardValue(total: Ranged<number> | null) {
  return {
    value: total?.data != null ? toCurrencyFormat(amountToPokt(total.data), 2) : 'N/A',
    tooltip: total?.data == null && !total?.range ? 'Indexer data unavailable' : undefined,
    note: coverageNote(total?.range ?? null),
  }
}

interface SummaryProps {
  addresses: Array<string>
  supplierAddresses: Array<string>
  noDataMessage?: string
  // Suppliers count and stake from igniter's DB (ServerSummary), then every SUPPLIERS_REFRESH_MS
  // from refreshSuppliers, a server action reading the same DB values. The indexer is not asked.
  suppliers: SuppliersSummary
  refreshSuppliers: () => Promise<SuppliersSummary>
  initialRewards: SummaryRewards
}

export default function Summary({
  addresses,
  supplierAddresses,
  noDataMessage = 'There is no data available for your nodes.',
  suppliers,
  refreshSuppliers,
  initialRewards
}: SummaryProps) {
  const client = useApolloClient()
  const { currentTime, settlementHeight, rewardsFallbackTick } = useHeightContext()
  const queryClient = useQueryClient()
  const suppliersKey = ['rewardsSummarySuppliers', addresses]
  // A failed refresh keeps the last values on screen; the next interval retries
  const { data: dbSuppliers = suppliers } = useQuery({
    queryKey: suppliersKey,
    queryFn: () => refreshSuppliers(),
    initialData: suppliers,
    staleTime: SUPPLIERS_REFRESH_MS,
    refetchInterval: SUPPLIERS_REFRESH_MS,
    enabled: addresses.length > 0,
  })
  const [rewards, setRewards] = useState<SummaryRewards>(initialRewards)
  const [rewardsError, setRewardsError] = useState(initialRewards.last24h == null)

  // New values from a server render (router.refresh()): the suppliers replace the cached ones; a
  // rewards window only when the server's is an answer and ends later (newerTotal), so a failed
  // server fetch never replaces good client rewards
  useEffect(() => {
    queryClient.setQueryData(suppliersKey, suppliers)
    // eslint-disable-next-line
  }, [suppliers])
  useEffect(() => {
    const next = { last24h: newerTotal(rewards.last24h, initialRewards.last24h), last48h: newerTotal(rewards.last48h, initialRewards.last48h) }
    if (next.last24h === rewards.last24h && next.last48h === rewards.last48h) return
    setRewards(next)
    if (next.last24h != null && next.last48h != null) setRewardsError(false)
    // eslint-disable-next-line
  }, [initialRewards])
  // Fetches running, and the id of the latest one: only the latest may write its result, so a slow
  // retry cannot overwrite a newer (settlement-triggered) fetch.
  const rewardsInFlightRef = useRef(0)
  const rewardsSeqRef = useRef(0)
  // The settlement height and fallback tick the rewards were last fetched for (height.tsx)
  const lastRefreshRef = useRef({ settlementHeight, rewardsFallbackTick })

  const fetchRewards = useCallback(async () => {
    if (!addresses.length) return
    const seq = ++rewardsSeqRef.current
    const isStale = () => seq !== rewardsSeqRef.current
    rewardsInFlightRef.current++

    try {
      const results = await Promise.all(
        batchArray(supplierAddresses).map((batch) =>
          client.query({
            query: rewardsWindowsDocument,
            variables: summaryVariables(addresses, batch, currentTime),
            fetchPolicy: 'network-only',
          }),
        ),
      )
      if (isStale()) return
      setRewards(combineRewardsWindows(results.map((r) => r.data)))
      setRewardsError(false)
    } catch {
      if (isStale()) return
      setRewardsError(true)
    } finally {
      rewardsInFlightRef.current--
    }
  }, [client, addresses, supplierAddresses, currentTime])

  // Refetch when the settlement height or its fallback tick moved since the last fetch
  useEffect(() => {
    const last = lastRefreshRef.current
    if (last.settlementHeight === settlementHeight && last.rewardsFallbackTick === rewardsFallbackTick) return
    lastRefreshRef.current = { settlementHeight, rewardsFallbackTick }
    fetchRewards()
    // eslint-disable-next-line
  }, [settlementHeight, rewardsFallbackTick])

  // While the rewards are in error, retry them on new blocks (capped, see useBlockRetry), skipped
  // while a fetch is running; a settlement-triggered fetch is never skipped.
  useBlockRetry({
    key: 'rewards',
    shouldRetry: addresses.length > 0 && (rewardsError || isFailedTotal(rewards.last24h) || isFailedTotal(rewards.last48h)),
    isBusy: () => rewardsInFlightRef.current > 0,
    run: fetchRewards,
  })

  const reward24h = useMemo(() => rewardValue(rewards.last24h), [rewards.last24h])
  const reward48h = useMemo(() => rewardValue(rewards.last48h), [rewards.last48h])

  if (!addresses.length) {
    return (
      <div className={'rounded-lg border h-[130px] pt-2 border-[color:--divider] bg-[color:--main-background] base-shadow flex w-full items-center justify-center'}>
        <NoData label={noDataMessage} />
      </div>
    )
  }

  return (
    <FourCard
      items={
        combineByIndex(
          labels,
          {
            1: <Value value={toCurrencyFormat(dbSuppliers.count)} />,
            2: <Value value={toCurrencyFormat(amountToPokt(dbSuppliers.stakeUpokt), 2)} />,
            3: (
              <Value
                {...reward24h}
                onRetry={rewardsError ? fetchRewards : undefined}
              />
            ),
            4: (
              <Value
                {...reward48h}
                onRetry={rewardsError ? fetchRewards : undefined}
              />
            ),
          }
        )
      }
    />
  )
}
