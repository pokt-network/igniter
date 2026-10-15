'use client'

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import { statusQuery } from '@igniter/graphql'
import { shownTabTicks } from '../../lib/settlement'
import {
  fallbackTick,
  initialRewardsEpoch,
  nextClockAt,
  onClock,
  onSettlementAnswer,
  rewardsEpochKey,
} from '../../lib/rewardsEpoch'

interface HeightContext {
  currentHeight: number
  networkHeight: number
  // first height or the latest height with relays
  sessionHeight: number
  updateNetworkHeight: () => void
  firstHeight: number
  currentTime: string
  // height of the last settlement the indexer's money tables hold (getLastSettlement); the rewards
  // read those tables, so they only change when it moves. It can lag the chain, moves on heights
  // with only expirations too, and goes back if the indexer rewinds.
  settlementHeight: number
  // the epoch the rewards are fetched for (rewardsEpoch.ts): it changes when they should be
  // fetched again; read it through useRewardsEpochChange or as a query key
  rewardsEpoch: string
}

const HeightContext = createContext<HeightContext>({
  currentHeight: 0,
  networkHeight: 0,
  firstHeight: 0,
  sessionHeight: 0,
  currentTime: '',
  settlementHeight: 0,
  rewardsEpoch: '0/0',
  updateNetworkHeight: () => {}
});

interface HeightContextProviderProps {
  children: React.ReactNode
  firstHeight: number
  networkHeight: number
  firstTime: string
  firstSettlementHeight: number
}

export default function HeightContextProvider({
                                                children,
                                                networkHeight: initialNetworkHeight,
                                                firstHeight,
                                                firstTime,
                                                firstSettlementHeight,
                                              }: HeightContextProviderProps) {
  const [skipQueries, setSkipQueries] = useState(true)
  const [networkHeight, setNetworkHeight] = useState(initialNetworkHeight)
  const [sessionHeight, setSessionHeight] = useState(Number(firstHeight))
  const [epoch, setEpoch] = useState(() => initialRewardsEpoch(firstSettlementHeight, Date.now()))
  const [{currentHeight, currentTime}, setState] = useState({
    currentHeight: Number(firstHeight || 0),
    currentTime: firstTime,
  })

  const {data, refetch} = useQuery(
    statusQuery,
    {
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
      // A failing field (getLastSettlement) comes back null with the rest of the answer
      errorPolicy: 'all',
      pollInterval: 15 * 1000,
      skipPollAttempt: () => document.hidden,
      skip: skipQueries
    }
  )

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSkipQueries(false)
    }, 10000)

    return () => clearTimeout(timeout)
  }, [])

  // The epoch's clock (rewardsEpoch.ts): one timer for a pending rewind and the fallback tick,
  // restarted on every change. A hidden tab does not tick: once shown, it decides on a status poll
  // started after that (its answer counts even when it equals the last one, which Apollo would not
  // report): a higher settlement height is a new epoch by itself; anything else, or a failed poll, ticks.
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) setEpoch((current) => fallbackTick(current, Date.now()))
    }
    const onVisible = () => {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', onVisible)
      const shownAt = epoch.height
      refetch().then(
        ({ data: status }) => {
          if (shownTabTicks(shownAt, Number(status?.lastSettlement?.height ?? 0))) tick()
        },
        tick,
      )
    }
    const timeout = setTimeout(() => {
      const { epoch: next, waitForShown } = onClock(epoch, Date.now(), document.hidden)
      if (waitForShown) document.addEventListener('visibilitychange', onVisible)
      // nothing due yet (the timer ran early): a copy restarts it
      else setEpoch(next === epoch ? { ...epoch } : next)
    }, Math.max(0, nextClockAt(epoch) - Date.now()))

    return () => {
      cancelled = true
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line
  }, [epoch])

  useEffect(() => {
    const block = data?.blocks?.nodes[0]

    setEpoch((current) => onSettlementAnswer(current, data?.lastSettlement?.height, Date.now()))

    const newBlockId = Number(block?.id)
    if (block && newBlockId > currentHeight) {
      setState({
        currentHeight: newBlockId,
        currentTime: block.timestamp || currentTime,
      })

      if (newBlockId > networkHeight) {
        setNetworkHeight(newBlockId)
      }

      if (Number(block.totalRelays) > 0) {
        setSessionHeight(newBlockId)
      }

      const targetHeight = data?._metadata?.targetHeight

      if (targetHeight) {
        setNetworkHeight(Number(targetHeight))
      }
    }
    // eslint-disable-next-line
  }, [data])

  return (
    <HeightContext.Provider
      value={{
        currentHeight,
        currentTime,
        networkHeight,
        firstHeight,
        sessionHeight,
        settlementHeight: epoch.height,
        rewardsEpoch: rewardsEpochKey(epoch),
        updateNetworkHeight: refetch,
      }}
    >
      {children}
    </HeightContext.Provider>
  )
}

export function useHeightContext() {
  return useContext(HeightContext)
}

/** Calls onChange when the rewards epoch changes (not on mount): when the rewards should be fetched again. */
export function useRewardsEpochChange(onChange: () => void) {
  const { rewardsEpoch } = useHeightContext()
  const lastRef = useRef(rewardsEpoch)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (lastRef.current === rewardsEpoch) return
    lastRef.current = rewardsEpoch
    onChangeRef.current()
  }, [rewardsEpoch])
}
