'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useQuery } from '@apollo/client'
import { statusQuery } from '@igniter/graphql'
import { matureRewind, nextSettlement, REWIND_CONFIRM_MS, shownTabTicks, type PendingRewind } from '../../lib/settlement'

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
  // counts REWARDS_FALLBACK_MS periods without a new settlement height: rewards refetch on it too,
  // so a lagging money step never freezes them
  rewardsFallbackTick: number
}

const HeightContext = createContext<HeightContext>({
  currentHeight: 0,
  networkHeight: 0,
  firstHeight: 0,
  sessionHeight: 0,
  currentTime: '',
  settlementHeight: 0,
  rewardsFallbackTick: 0,
  updateNetworkHeight: () => {}
});

// Mainnet settles about every 20 minutes (median gap between settlement heights over 30 days:
// 20.3 min, max 25 min, 2026-10-14), so the fallback waits three times that: it fires only when
// the indexer's money step is stuck, not on a healthy chain.
const REWARDS_FALLBACK_MS = 60 * 60 * 1000

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
  const [settlementHeight, setSettlementHeight] = useState(firstSettlementHeight)
  const [rewardsFallbackTick, setRewardsFallbackTick] = useState(0)
  // A lower settlement height waiting to hold long enough to be a rewind (settlement.ts)
  const [pendingRewind, setPendingRewind] = useState<PendingRewind | null>(null)
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

  // Restarts on every new settlement height and every tick. A hidden tab waits until it is shown,
  // then decides on a status poll started after that (its answer counts even when it equals the last
  // one, which Apollo would not report): a higher settlement height refetches the rewards by itself
  // and restarts this timer; anything else, or a failed poll, ticks.
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) setRewardsFallbackTick((t) => t + 1)
    }
    const onVisible = () => {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', onVisible)
      const shownAt = settlementHeight
      refetch().then(
        ({ data: status }) => {
          if (shownTabTicks(shownAt, Number(status?.lastSettlement?.height ?? 0))) tick()
        },
        tick,
      )
    }
    const timeout = setTimeout(() => {
      if (document.hidden) document.addEventListener('visibilitychange', onVisible)
      else tick()
    }, REWARDS_FALLBACK_MS)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line
  }, [settlementHeight, rewardsFallbackTick])

  useEffect(() => {
    if (!pendingRewind) return
    const timeout = setTimeout(() => {
      const next = matureRewind(settlementHeight, pendingRewind, Date.now())
      setPendingRewind(next.pending)
      if (next.height !== settlementHeight) setSettlementHeight(next.height)
    }, Math.max(0, pendingRewind.since + REWIND_CONFIRM_MS - Date.now()))

    return () => clearTimeout(timeout)
  }, [pendingRewind, settlementHeight])

  useEffect(() => {
    const block = data?.blocks?.nodes[0]

    // A rewind (a lower height) becomes pending; it is taken once it has held for REWIND_CONFIRM_MS,
    // here or by the timer below (Apollo drops answers equal to the last one)
    const next = nextSettlement(settlementHeight, data?.lastSettlement?.height, pendingRewind, Date.now())
    setPendingRewind(next.pending)
    if (next.height !== settlementHeight) setSettlementHeight(next.height)

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
        settlementHeight,
        rewardsFallbackTick,
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
