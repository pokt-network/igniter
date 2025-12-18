'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useQuery } from '@apollo/client'
import { statusQuery } from '@igniter/graphql'

interface HeightContext {
  currentHeight: number
  networkHeight: number
  // first height or the latest height with relays
  sessionHeight: number
  updateNetworkHeight: () => void
  firstHeight: number
  currentTime: string
}

const HeightContext = createContext<HeightContext>({
  currentHeight: 0,
  networkHeight: 0,
  firstHeight: 0,
  sessionHeight: 0,
  currentTime: '',
  updateNetworkHeight: () => {}
});

interface HeightContextProviderProps {
  children: React.ReactNode
  firstHeight: number
  networkHeight: number
  firstTime: string
}

export default function HeightContextProvider({
                                                children,
                                                networkHeight: initialNetworkHeight,
                                                firstHeight,
                                                firstTime,
                                              }: HeightContextProviderProps) {
  const [skipQueries, setSkipQueries] = useState(true)
  const [networkHeight, setNetworkHeight] = useState(initialNetworkHeight)
  const [sessionHeight, setSessionHeight] = useState(Number(firstHeight))
  const [{currentHeight, currentTime}, setState] = useState({
    currentHeight: Number(firstHeight || 0),
    currentTime: firstTime,
  })

  const {data, refetch} = useQuery(
    statusQuery,
    {
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
      pollInterval: 15 * 1000,
      skip: skipQueries
    }
  )

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSkipQueries(false)
    }, 10000)

    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    const block = data?.blocks?.nodes[0]

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
