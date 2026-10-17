import { useEffect, useRef } from 'react'

/**
 * Calls refetch once when any of `keys` changed since the last render (not on mount): keys that
 * change in the same commit give one call. refetch is read when it runs, so it need not be stable.
 */
export default function useRefetchOnChange(keys: ReadonlyArray<unknown>, refetch: () => void) {
  const lastRef = useRef(keys)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch

  useEffect(() => {
    const last = lastRef.current
    if (last.length === keys.length && last.every((key, i) => Object.is(key, keys[i]))) return
    lastRef.current = keys
    refetchRef.current()
    // eslint-disable-next-line
  }, keys)
}
