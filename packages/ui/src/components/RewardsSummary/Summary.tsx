'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client'
import ErrorRetry from '../ErrorRetry'
import FourCard from '../FourCards/FourCard'
import { combineByIndex } from '../FourCards/utils'
import { labels } from './constants'
import NoData from '../NoData'
import { amountToPokt, toCurrencyFormat } from '../../lib/utils'
import { DocumentNodeData } from '../../lib/graphql/types'
import { useHeightContext } from '../../context/Height/height'
import { rewardsWindowsDocument, summaryDocument, suppliersSummaryDocument } from '@igniter/graphql/rewards'
import { summaryVariables } from './operations'
import { batchArray } from '../../lib/batch'
import { coverageNote, Ranged } from '../../lib/range'
import { combineRewardsWindows, RewardsWindows } from '../../lib/rewards'
import SummaryLoader from './Loader'

// The rewards totals normalised once (see range.ts); null: they could not be fetched
export type SummaryData = Omit<DocumentNodeData<typeof summaryDocument>, 'last24h' | 'last48h'> & {
  [K in keyof RewardsWindows]: RewardsWindows[K] | null
}
type SuppliersData = DocumentNodeData<typeof suppliersSummaryDocument>

// Suppliers and stake change on any stake or unstake, so they refresh on a timer; rewards only
// change when claims settle, so they refresh on a new settlement height.
const SUPPLIERS_REFRESH_MS = 60 * 1000

function aggregateSuppliersResults(results: SuppliersData[]): Pick<SummaryData, 'suppliers'> {
  return {
    suppliers: {
      totalCount: results.reduce((sum, d) => sum + (d.suppliers?.totalCount ?? 0), 0),
      aggregates: {
        sum: {
          stakeAmount: results.reduce((sum, d) => sum + Number(d.suppliers?.aggregates?.sum?.stakeAmount ?? 0), 0),
        },
      },
    },
  }
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
  isOwners: boolean
  addresses: Array<string>
  supplierAddresses: Array<string>
  noDataMessage?: string
  initialData: SummaryData | null
  initialError: boolean
}

export default function Summary({
  isOwners,
  addresses,
  supplierAddresses,
  noDataMessage = 'There is no data available for your nodes.',
  initialError,
  initialData
}: SummaryProps) {
  const client = useApolloClient()
  const { currentHeight, firstHeight, currentTime, settlementHeight, firstSettlementHeight } = useHeightContext()
  const [data, setData] = useState<SummaryData | null>(initialData)
  const [error, setError] = useState(initialError)
  // Tracked apart from `error`: the suppliers refresh can succeed and hide the error card while
  // the rewards are still missing, and those would otherwise wait for the next settlement.
  const [rewardsError, setRewardsError] = useState(initialError || initialData?.last24h == null)
  // Rewards fetches running, and the id of the latest one: only the latest may write its result,
  // so a slow retry cannot overwrite a newer settlement-triggered fetch.
  const rewardsInFlightRef = useRef(0)
  const rewardsSeqRef = useRef(0)
  const suppliersInFlightRef = useRef(0)
  const [isLoading, setIsLoading] = useState(false)
  const firstRenderRef = useRef(true)
  const lastValueRef = useRef<SummaryData | null>(initialData)

  const fetchBatched = useCallback(async (part: 'rewards' | 'suppliers') => {
    if (!addresses.length) return
    const seq = part === 'rewards' ? ++rewardsSeqRef.current : 0
    const isStale = () => part === 'rewards' && seq !== rewardsSeqRef.current
    const inFlightRef = part === 'rewards' ? rewardsInFlightRef : suppliersInFlightRef
    inFlightRef.current++

    setIsLoading(true)
    try {
      const batches = batchArray(supplierAddresses)
      let update: Partial<SummaryData>

      if (part === 'rewards') {
        const results = await Promise.all(
          batches.map((batch) => {
            const v = summaryVariables(isOwners, addresses, batch, currentTime)
            return client.query({
              query: rewardsWindowsDocument,
              variables: {
                addresses: v.addresses,
                supplierAddresses: v.supplierAddresses,
                currentDate: v.currentDate,
                last24Hours: v.last24Hours,
                last48Hours: v.last48Hours,
              },
              fetchPolicy: 'network-only',
            })
          }),
        )
        update = combineRewardsWindows(results.map((r) => r.data))
      } else {
        const results = await Promise.all(
          batches.map((batch) =>
            client.query({
              query: suppliersSummaryDocument,
              variables: { filter: summaryVariables(isOwners, addresses, batch, currentTime).filter },
              fetchPolicy: 'network-only',
            }),
          ),
        )
        update = aggregateSuppliersResults(results.map((r) => r.data))
      }

      if (isStale()) return

      setData((prev) => {
        const next = { ...prev, ...update } as SummaryData
        lastValueRef.current = next
        return next
      })
      setError(false)
      if (part === 'rewards') setRewardsError(false)
    } catch {
      if (isStale()) return
      setError(true)
      if (part === 'rewards') setRewardsError(true)
    } finally {
      setIsLoading(false)
      inFlightRef.current--
    }
  }, [client, isOwners, addresses, supplierAddresses, currentTime])

  const fetchAll = useCallback(() => {
    fetchBatched('suppliers')
    fetchBatched('rewards')
  }, [fetchBatched])

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }

    if (!addresses.length) return

    if (settlementHeight !== firstSettlementHeight) {
      fetchBatched('rewards')
    }
    // eslint-disable-next-line
  }, [settlementHeight])

  // While the rewards are in error or the suppliers are missing (a failed first load), retry them
  // on every new block instead of waiting for a settlement or the suppliers timer. Each part is
  // skipped while a fetch of it is running; a settlement-triggered fetch is never skipped.
  useEffect(() => {
    if (!addresses.length || currentHeight === firstHeight) return
    if (rewardsError && rewardsInFlightRef.current === 0) fetchBatched('rewards')
    if (data?.suppliers == null && suppliersInFlightRef.current === 0) fetchBatched('suppliers')
    // eslint-disable-next-line
  }, [currentHeight])

  // The interval reads the latest fetchBatched through a ref, so a new block does not reset it.
  const fetchBatchedRef = useRef(fetchBatched)
  fetchBatchedRef.current = fetchBatched

  useEffect(() => {
    if (!addresses.length) return

    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchBatchedRef.current('suppliers')
      }
    }, SUPPLIERS_REFRESH_MS)

    return () => clearInterval(interval)
  }, [addresses.length])

  if (isLoading && !lastValueRef.current) {
    return <SummaryLoader />
  } else if (error && !lastValueRef.current) {
    return (
      <div className={"bg-[color:--main-background] pt-3 pb-1 gap-1 rounded-lg border border-[color:--divider] base-shadow"}>
        <ErrorRetry
          onRetry={fetchAll}
          errorMessage={'Oops. There was an error loading the summary data.'}
        />
      </div>
    )
  }

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
            1: (
              <Value
                value={
                  data?.suppliers != null
                    ? toCurrencyFormat(data.suppliers.totalCount || 0)
                    : 'N/A'
                }
                tooltip={data?.suppliers == null ? 'Indexer data unavailable' : undefined}
                onRetry={data?.suppliers == null ? () => fetchBatched('suppliers') : undefined}
              />
            ),
            2: (
              <Value
                value={
                  data?.suppliers != null
                    ? toCurrencyFormat(amountToPokt(data.suppliers.aggregates?.sum?.stakeAmount), 2)
                    : 'N/A'
                }
                tooltip={data?.suppliers == null ? 'Indexer data unavailable' : undefined}
                onRetry={data?.suppliers == null ? () => fetchBatched('suppliers') : undefined}
              />
            ),
            3: (
              <Value
                {...rewardValue(data?.last24h ?? null)}
                onRetry={rewardsError ? () => fetchBatched('rewards') : undefined}
              />
            ),
            4: (
              <Value
                {...rewardValue(data?.last48h ?? null)}
                onRetry={rewardsError ? () => fetchBatched('rewards') : undefined}
              />
            ),
          }
        )
      }
    />
  )
}
