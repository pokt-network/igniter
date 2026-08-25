'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { toast } from '../components/sonner'

/**
 * Client-side messages that surface in the notification bell alongside the
 * server-side event feed.
 *
 * These are the failures a user action produces in the browser — a delete that
 * the server rejected, a channel test that timed out — which have no row in
 * `notification_events` and never will: they are not account events, and some
 * happen before there is an identity to file them under. They used to render as
 * sticky header banners; the bell is where they live now, so a long server error
 * sits in a reviewable list instead of a corner toast on a timer.
 *
 * Session-scoped on purpose: nothing here survives a reload. Anything that must
 * outlive the tab belongs in `notification_events`, written by the server.
 *
 * Not for a refused click. A precondition the client checked itself — a delete
 * the UI blocks before calling the server — produced no outcome to review, and
 * filing it here only bumps a badge the user has no reason to open. Those are
 * toasts (see `components/sonner`). What lands here is a server's answer:
 * something was attempted and came back with text worth reading twice.
 *
 * A message filed while a bell was mounted stays in the store if the user then
 * navigates somewhere the bell does not render; it is simply out of view there
 * and comes back on return. Only the push is guarded, not the later unmount.
 *
 * A module-level store rather than a React context so any client component can
 * report a failure with a plain call — no provider to thread, no hook rules to
 * satisfy inside a catch block. Only the bell subscribes.
 */
export type SessionMessageSeverity = 'error' | 'warning' | 'info' | 'success'

export interface SessionMessage {
  id: string
  severity: SessionMessageSeverity
  title: string
  /** Optional second line; the long/raw part of a server error goes here. */
  description?: string
  createdAt: Date
}

// Stable empty reference: useSyncExternalStore compares snapshots by identity,
// and a fresh [] on every server render would loop.
const EMPTY: SessionMessage[] = []

let messages: SessionMessage[] = EMPTY
let autoId = 0
const listeners = new Set<() => void>()

// Ids currently shown as fallback toasts (pushed while no bell was mounted).
// Tracked so dismissing a message can also clear its toast without touching
// unrelated ones — a plain `toast.dismiss()` would take out successes too.
const fallbackIds = new Set<string>()

// How many bells are actually on screen. Subscribing is not enough to count: a
// bell hook still runs on routes where the bell renders nothing, and some routes
// (the provider setup wizard) have a top bar with no bell at all. Pushing there
// would file a message nothing ever displays, so those fall back to a toast.
let sinks = 0

function publish(next: SessionMessage[]) {
  messages = next
  for (const listener of listeners) listener()
}

export interface PushOptions {
  /**
   * Stable key for a recurring failure (e.g. `channel-test-error-7`). Pushing
   * the same id twice replaces the existing message in place instead of stacking
   * duplicates — same semantics as a toast id.
   */
  id?: string
  description?: string
}

export const sessionMessages = {
  /**
   * Called by a bell that is actually rendering. Returns the deregister fn.
   * While no bell is registered, `push` degrades to a toast.
   */
  registerSink(): () => void {
    sinks += 1
    return () => {
      sinks = Math.max(0, sinks - 1)
    }
  },

  push(severity: SessionMessageSeverity, title: string, options: PushOptions = {}): string {
    const id = options.id ?? `session-message-${++autoId}`

    if (sinks === 0) {
      // No bell to file this in — land it in the corner instead of the panel.
      // Pinned like a bell card would be: a card is dismissed by hand, so the
      // stand-in should not expire on its own either.
      fallbackIds.add(id)
      toast[severity](title, {
        id,
        description: options.description,
        duration: Infinity,
      })
      return id
    }

    // Same failure, seen once with no bell and again with one: clear the pinned
    // stand-in so the card does not sit next to a duplicate of itself.
    if (fallbackIds.delete(id)) toast.dismiss(id)

    const message: SessionMessage = {
      id,
      severity,
      title,
      description: options.description,
      createdAt: new Date(),
    }
    // Newest first, matching the bell's ordering of server events.
    publish([message, ...messages.filter((m) => m.id !== id)])
    return id
  },

  dismiss(id: string) {
    if (fallbackIds.delete(id)) toast.dismiss(id)
    if (!messages.some((m) => m.id === id)) return
    publish(messages.filter((m) => m.id !== id))
  },

  dismissAll() {
    // "Mark all as read" should clear pinned stand-ins too, or they outlive the
    // cards they stood in for. Only ids this store raised — never other toasts.
    for (const id of fallbackIds) toast.dismiss(id)
    fallbackIds.clear()
    if (messages.length === 0) return
    publish(EMPTY)
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getSnapshot(): SessionMessage[] {
    return messages
  },
}

/** Report a failure to the bell. Returns the message id, for manual dismissal. */
export const notify = {
  error: (title: string, options?: PushOptions) => sessionMessages.push('error', title, options),
  warning: (title: string, options?: PushOptions) => sessionMessages.push('warning', title, options),
  info: (title: string, options?: PushOptions) => sessionMessages.push('info', title, options),
  success: (title: string, options?: PushOptions) => sessionMessages.push('success', title, options),
}

/**
 * Subscribe a bell to the store. Pass `active: false` on routes where the bell
 * renders nothing, so messages raised there fall back to a toast instead of
 * disappearing into a panel the user cannot open.
 */
export function useSessionMessages(active = true): SessionMessage[] {
  useEffect(() => {
    if (!active) return
    return sessionMessages.registerSink()
  }, [active])

  return useSyncExternalStore(
    sessionMessages.subscribe,
    sessionMessages.getSnapshot,
    () => EMPTY,
  )
}
