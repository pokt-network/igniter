'use client'

import {
  rewardsByAddressAndTimeGroupByDateVariables,
} from './operations'
import { useChartType } from '../BaseLineBarChart/ChartType'
import { useDataContext } from '../../context/data'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client'
import ErrorRetry  from '../ErrorRetry'
import NoData from '../NoData'
import BaseLineBarChart from '../BaseLineBarChart/BaseLineBarChart'
import { fillChartData, LineBarItem, normalizeIsoDate } from '../BaseLineBarChart/utils'
import isEqual from 'lodash/isEqual'
import orderBy from 'lodash/orderBy'
import useDidMountEffect from '../../hooks/useDidMountEffect'
import ItemsSelector from './ItemsSelector'
import { clsx } from 'clsx'
import { useGroupAll } from './GroupAllSwitch'
import { amountToPokt, getShortAddress, toCompactFormat, toCurrencyFormat } from '../../lib/utils'
import { DocumentNodeData, ExtractVariables } from '../../hooks/useFetchOnNewBlock'
import { ContentLoader } from './Loader'
import { rewardsByAddressAndTimeGroupByDateDocument } from '@igniter/graphql/rewards'
import { useSelectedTime } from './TimeSelector'
import { useHeightContext } from '../../context/Height/height'
import { batchArray } from '../../lib/batch'

export interface RewardItem extends LineBarItem {
  totalAmount: number
}

interface RewardsByAddressChartProps {
  initialError: boolean
  addresses: Array<string>
  supplierAddresses: Array<string>
  noDataMessage?: string
  initialData: DocumentNodeData<typeof rewardsByAddressAndTimeGroupByDateDocument> | null
  initialVariables: ExtractVariables<typeof rewardsByAddressAndTimeGroupByDateDocument> | null
}

export default function RewardsByAddressChart({
  initialError,
  addresses,
  supplierAddresses,
  initialData,
  initialVariables,
  noDataMessage = 'You do not have any rewards in the time selected..'
}: RewardsByAddressChartProps) {
  const {chartType} = useChartType()
  const {setData, data} = useDataContext<RewardItem>()
  const {selectedTime} = useSelectedTime()
  const client = useApolloClient()
  const { currentHeight, currentTime, firstHeight } = useHeightContext()
  const lastVariables = useRef<ExtractVariables<typeof rewardsByAddressAndTimeGroupByDateDocument>>(initialVariables)

  type RewardsData = DocumentNodeData<typeof rewardsByAddressAndTimeGroupByDateDocument>
  const [rawData, setRawData] = useState<RewardsData | null>(initialData)
  const [error, setError] = useState(initialError)
  const [isLoading, setIsLoading] = useState(false)
  const firstRenderRef = useRef(true)
  const lastSelectedTimeRef = useRef(selectedTime)

  const fetchBatched = useCallback(async () => {
    if (!addresses.length) return

    setIsLoading(true)
    try {
      const batches = batchArray(supplierAddresses)
      const results = await Promise.all(
        batches.map((batch) => {
          const vars = rewardsByAddressAndTimeGroupByDateVariables(
            addresses,
            batch,
            currentTime,
            selectedTime,
          )
          lastVariables.current = vars
          return client.query({
            query: rewardsByAddressAndTimeGroupByDateDocument,
            variables: vars,
            fetchPolicy: 'network-only',
          })
        }),
      )

      const aggregated = results.reduce(
        (acc, { data: d }) => {
          if (!acc) return d
          const accRewards = Array.isArray(acc.rewards) ? acc.rewards : []
          const dRewards = Array.isArray(d.rewards) ? d.rewards : []
          return { ...d, rewards: [...accRewards, ...dRewards] }
        },
        null as RewardsData | null,
      )

      setRawData(aggregated)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
    }
  }, [client, addresses, supplierAddresses, currentTime, selectedTime])

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }

    if (!addresses.length) return

    // Refetch on new session or when selectedTime changes
    const timeChanged = lastSelectedTimeRef.current !== selectedTime
    lastSelectedTimeRef.current = selectedTime

    if (
      timeChanged ||
      currentHeight !== firstHeight
    ) {
      fetchBatched()
    }
    // eslint-disable-next-line
  }, [currentHeight, selectedTime])

  const {groupAll: groupAllAddresses} = useGroupAll()

  const processedData: Record<string, Array<RewardItem>> = useMemo(() => {
    const rawPoints: Array<{date_truncated: string, total_amount: string | number, address: string}> = rawData?.rewards || []

    if (!addresses.length || !rawData?.rewards) return {}

    if (groupAllAddresses) {
      const amountByDate = rawPoints.reduce((acc, item) => ({
        ...acc,
        [item.date_truncated]: (acc[item.date_truncated] || 0) + Number(item.total_amount)
      }), {} as Record<string, number>)

      const dataNotFilled = Object.keys(amountByDate).map((date) => ({
        id: '',
        point: normalizeIsoDate(date),
        start_date: normalizeIsoDate(date),
        totalAmount: amountByDate[date]
      }))

      return {
        'all': fillChartData({
          data: dataNotFilled,
          startDate: lastVariables?.current?.startDate,
          endDate: lastVariables?.current?.endDate,
          unitToFormatDate: lastVariables?.current?.truncInterval === 'hour' ? 'hour' : 'day',
          defaultProps: {
            totalAmount: 0,
          }
        })
      } as Record<string, Array<RewardItem>>
    }

    const dataByAddress = rawPoints.reduce((acc: Record<string, Array<RewardItem>>, item) => ({
      ...acc,
      [item.address]: [
        ...(acc[item.address] || []),
        {
          id: item.address,
          point: normalizeIsoDate(item.date_truncated),
          start_date: normalizeIsoDate(item.date_truncated),
          totalAmount: Number(item.total_amount)
        },
      ]
    }), {} as Record<string, Array<RewardItem>>)

    return addresses.reduce((acc, address) => ({
      ...acc,
      [address]: fillChartData({
        data: dataByAddress[address] || [],
        startDate: lastVariables?.current?.startDate,
        endDate: lastVariables?.current?.endDate,
        unitToFormatDate: lastVariables?.current?.truncInterval === 'hour' ? 'hour' : 'day',
        defaultProps: {
          id: address,
          totalAmount: 0,
        }
      })
    }), {})
  }, [rawData, addresses, groupAllAddresses])

  const addressesWithRewards = useMemo(() => {
    return orderBy(Object.entries(processedData).map(([address, items]) => ({
      id: address,
      label: getShortAddress(address, 6),
      value: items.reduce((acc, item) => {
        return acc + amountToPokt(item.totalAmount)
      }, 0)
    })), ['value'], ['desc'])
  }, [processedData])

  const [selectedAddresses, setSelectedAddresses] = React.useState<Array<string>>(
    addressesWithRewards.map(item => item.id).slice(0, 5)
  )

  useDidMountEffect(() => {
    if (groupAllAddresses) return

    const newSelection = addressesWithRewards.map(item => item.id).slice(0, 5)

    if (!isEqual(newSelection, selectedAddresses)) {
      setSelectedAddresses(newSelection)
    }
  }, [processedData])

  useEffect(() => {
    let newData: Array<RewardItem>

    if (groupAllAddresses) {
      newData = processedData['all'] || []
    } else {
      newData = Object.entries(processedData).reduce((acc, [address,items]) => {
        if (selectedAddresses.includes(address)) {
          return acc.concat(items)
        }
        return acc
      }, [] as Array<RewardItem>)
    }

    if (!isEqual(newData, data)) {
      setData(newData)
    }
    // eslint-disable-next-line
  }, [processedData, selectedAddresses])

  const changeSelectedAddresses = (addresses: Array<string>) => {
    setSelectedAddresses(addresses)
  }

  const filteredDataByAddress: Record<string, Array<RewardItem>> = useMemo(() => {
    if (groupAllAddresses) {
      return data.reduce((acc, item) => {
        acc.eth.push(item)
        return acc
      }, {'eth': [] as Array<RewardItem>})
    }

    return data.reduce((acc, item) => {
      if (selectedAddresses.includes(item.id)) {
        if (acc[item.id]) {
          acc[item.id]?.push(item)
        } else {
          acc[item.id] = [item]
        }
      }

      return acc
    }, {} as Record<string, Array<RewardItem>> )
  }, [data, selectedAddresses, groupAllAddresses])

  let content: React.ReactNode

  if (!addresses.length) {
    content = (
      <div className={'mt-[-10px] flex w-full items-center justify-center'}>
        <NoData label={noDataMessage} />
      </div>
    )
  } else if (isLoading) {
    content = (
      <ContentLoader chartType={chartType} hideSelector={groupAllAddresses} />
    )
  } else if (error) {
    content = (
      <div className={'mt-[-10px] flex w-full grow'}>
        <ErrorRetry
          onRetry={fetchBatched}
        />
      </div>
    )
  } else {
    if (data.length === 0 && addressesWithRewards.every(i => i.value === 0)) {
      content = (
        <>
          <div className={'mt-[-10px] flex w-full items-center justify-center'}>
            <NoData label={'No data available for the selected time.'} />
          </div>
        </>
      )
    } else {
      content = (
        <>
          <div className={'flex flex-col xl:flex-row w-full grow items-center gap-4'}>
            <div
              className={
                clsx(
                  'order-2 xl:order-1 transition-none transform-none',
                  groupAllAddresses && 'w-full h-full xl:h-[328px]',
                  !groupAllAddresses && 'w-full xl:!w-[calc(100%-260px-16px)] h-[270px] sm:h-[328px]'
                )
              }
            >
              <BaseLineBarChart
                data={filteredDataByAddress}
                displayColorsInTooltip={false}
                yAxisKey={'totalAmount'}
                yAxisLabel={'Rewards (POKT)'}
                chartType={chartType}
                unitToFormatDate={lastVariables?.current?.truncInterval === 'hour' ? 'hour' : 'day'}
                getTooltipLabel={(item) => {
                  const value = `${toCurrencyFormat(amountToPokt(item.totalAmount))} POKT`

                  if (groupAllAddresses) {
                    return value
                  }

                  return [
                    `Address: ${getShortAddress(item.id, 6)}`,
                    `Rewards: ${value}`,
                  ]
                }}
                formatValueAxisY={
                  (value) => {
                    const pokt = amountToPokt(value)

                    if (pokt >= 1e6) {
                      return toCompactFormat(pokt)
                    }

                    return toCurrencyFormat(pokt)
                  }
                }
              />
            </div>
            {!groupAllAddresses && (
              <div className={'min-h-[180px] h-[180px] xl:h-[320px] w-full xl:min-w-[260px] xl:w-[260px] order-1 xl:order-2'}>
                <ItemsSelector
                  data={addressesWithRewards}
                  selectedItems={selectedAddresses}
                  changeSelectedItems={changeSelectedAddresses}
                />
              </div>
            )}
          </div>
        </>
      )
    }
  }

  return (
    <div
      className={
        clsx(
          !isLoading && 'flex flex-col items-center px-4 pt-2 pb-4 h-full gap-4',
          isLoading && 'flex flex-col xl:flex-row items-center px-4 pt-2 pb-4 h-[calc(100%-44px)] gap-4'
        )
      }
    >
      {content}
    </div>
  )
}
