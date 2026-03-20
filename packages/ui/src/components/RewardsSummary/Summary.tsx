'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client'
import ErrorRetry from '../ErrorRetry'
import FourCard from '../FourCards/FourCard'
import { combineByIndex } from '../FourCards/utils'
import { labels } from './constants'
import NoData from '../NoData'
import { amountToPokt, toCurrencyFormat } from '../../lib/utils'
import { DocumentNodeData } from '../../hooks/useFetchOnNewBlock'
import { useHeightContext } from '../../context/Height/height'
import { summaryDocument } from '@igniter/graphql/rewards'
import { summaryVariables } from './operations'
import { batchArray } from '../../lib/batch'
import SummaryLoader from './Loader'

type SummaryData = DocumentNodeData<typeof summaryDocument>

function aggregateSummaryResults(results: SummaryData[]): SummaryData {
  return results.reduce((acc, d) => {
    if (!acc) return d
    return {
      ...d,
      suppliers: {
        ...d.suppliers,
        totalCount:
          (acc.suppliers?.totalCount ?? 0) +
          (d.suppliers?.totalCount ?? 0),
        aggregates: {
          ...d.suppliers?.aggregates,
          sum: {
            stakeAmount:
              Number(acc.suppliers?.aggregates?.sum?.stakeAmount ?? 0) +
              Number(d.suppliers?.aggregates?.sum?.stakeAmount ?? 0),
          },
        },
      },
      last24h:
        Number(acc.last24h ?? 0) + Number(d.last24h ?? 0),
      last48h:
        Number(acc.last48h ?? 0) + Number(d.last48h ?? 0),
    }
  }) as SummaryData
}

function Value({value}: {value: string}) {
  return (
    <p className={'mt-1 sm:text-lg font-medium'}>
      {value}
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
  const { currentHeight, currentTime, firstHeight } = useHeightContext()
  const [data, setData] = useState<SummaryData | null>(initialData)
  const [error, setError] = useState(initialError)
  const [isLoading, setIsLoading] = useState(false)
  const firstRenderRef = useRef(true)
  const lastValueRef = useRef<SummaryData | null>(initialData)

  const fetchBatched = useCallback(async () => {
    if (!addresses.length) return

    setIsLoading(true)
    try {
      const batches = batchArray(supplierAddresses)
      const results = await Promise.all(
        batches.map((batch) =>
          client.query({
            query: summaryDocument,
            variables: summaryVariables(isOwners, addresses, batch, currentTime),
            fetchPolicy: 'network-only',
          }),
        ),
      )

      const aggregated = aggregateSummaryResults(results.map((r) => r.data))
      lastValueRef.current = aggregated
      setData(aggregated)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
    }
  }, [client, isOwners, addresses, supplierAddresses, currentTime])

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }

    if (!addresses.length) return

    if (currentHeight !== firstHeight) {
      fetchBatched()
    }
    // eslint-disable-next-line
  }, [currentHeight])

  if (isLoading && !lastValueRef.current) {
    return <SummaryLoader />
  } else if (error && !lastValueRef.current) {
    return (
      <div className={"bg-[color:--main-background] pt-3 pb-1 gap-1 rounded-lg border border-[color:--divider] base-shadow"}>
        <ErrorRetry
          onRetry={fetchBatched}
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
                  toCurrencyFormat(
                    amountToPokt(
                      data?.last24h
                    ),
                    2,
                  )
                }
              />
            ),
            4: (
              <Value
                value={
                  toCurrencyFormat(
                    amountToPokt(
                      data?.last48h
                    ),
                    2,
                  )
                }
              />
            ),
          }
        )
      }
    />
  )
}
