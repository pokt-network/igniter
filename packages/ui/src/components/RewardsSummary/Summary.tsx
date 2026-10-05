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
import SummaryLoader from './Loader'

type SummaryData = DocumentNodeData<typeof summaryDocument>
type SuppliersData = DocumentNodeData<typeof suppliersSummaryDocument>
type RewardsData = DocumentNodeData<typeof rewardsWindowsDocument>

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

function aggregateRewardsResults(results: RewardsData[]): Pick<SummaryData, 'last24h' | 'last48h'> {
  return {
    last24h: results.reduce((sum, d) => sum + Number(d.last24h ?? 0), 0),
    last48h: results.reduce((sum, d) => sum + Number(d.last48h ?? 0), 0),
  }
}

function Value({value, tooltip}: {value: string, tooltip?: string}) {
  return (
    <p className={'mt-1 sm:text-lg font-medium'} title={tooltip}>
      {value}{tooltip && <span className="inline-block ml-1 text-xs text-text-tertiary cursor-help" title={tooltip}>&#9432;</span>}
    </p>
  )
}

interface SummaryProps {
  isOwners: boolean
  addresses: Array<string>
  supplierAddresses: Array<string>
  noDataMessage?: string
  initialData: DocumentNodeData<typeof summaryDocument> | null
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
  const { currentTime, settlementHeight, firstSettlementHeight } = useHeightContext()
  const [data, setData] = useState<SummaryData | null>(initialData)
  const [error, setError] = useState(initialError)
  const [isLoading, setIsLoading] = useState(false)
  const firstRenderRef = useRef(true)
  const lastValueRef = useRef<SummaryData | null>(initialData)

  const fetchBatched = useCallback(async (part: 'rewards' | 'suppliers') => {
    if (!addresses.length) return

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
        update = aggregateRewardsResults(results.map((r) => r.data))
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

      setData((prev) => {
        const next = { ...prev, ...update } as SummaryData
        lastValueRef.current = next
        return next
      })
      setError(false)
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
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
                  toCurrencyFormat(
                    data?.suppliers?.totalCount || 0,
                  )
                }
              />
            ),
            2: (
              <Value
                value={
                  toCurrencyFormat(
                    amountToPokt(
                      data?.suppliers?.aggregates?.sum?.stakeAmount
                    ),
                    2,
                  )
                }
              />
            ),
            3: (
              <Value
                value={
                  data?.last24h != null
                    ? toCurrencyFormat(amountToPokt(data.last24h), 2)
                    : 'N/A'
                }
                tooltip={data?.last24h == null ? 'Indexer data unavailable' : undefined}
              />
            ),
            4: (
              <Value
                value={
                  data?.last48h != null
                    ? toCurrencyFormat(amountToPokt(data.last48h), 2)
                    : 'N/A'
                }
                tooltip={data?.last48h == null ? 'Indexer data unavailable' : undefined}
              />
            ),
          }
        )
      }
    />
  )
}
