'use client'
import { useSession } from 'next-auth/react'
import { useEffect, useRef } from 'react'
import { signOutExpiredSession } from './sessionExpiredSignOut'
import { expiryDelay, localDeadline } from './sessionExpiryTimer'

// Signs out when the session reaches its absolute end, instead of waiting for
// the next action or poll to be rejected.
export default function SessionExpiryWatcher() {
  const { data: session, status } = useSession()
  const sessionRemainingMs = session?.sessionRemainingMs
  const lastDeadline = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (typeof sessionRemainingMs !== 'number') return
    // Anchored to the browser clock at receipt, so a browser clock off from the server's
    // does not move the sign-out. Each refetch re-anchors it.
    const deadline = localDeadline(sessionRemainingMs, Date.now())
    lastDeadline.current = deadline
    let timer: ReturnType<typeof setTimeout> | undefined
    // Re-checks on wake-up: a clamped delay ends before the deadline does.
    const check = () => {
      const delay = expiryDelay(deadline, Date.now())
      if (delay === 0) {
        signOutExpiredSession()
        return
      }
      timer = setTimeout(check, delay)
    }
    check()
    return () => clearTimeout(timer)
  }, [sessionRemainingMs])

  // A tab that slept past the deadline refetches the session on focus and gets
  // none, which clears the timer above before it fires. A deadline already
  // passed means that loss was the expiry, not a sign-out.
  useEffect(() => {
    if (status !== 'unauthenticated') return
    const deadline = lastDeadline.current
    if (deadline !== undefined && expiryDelay(deadline, Date.now()) === 0) {
      signOutExpiredSession()
    }
  }, [status])

  return null
}
