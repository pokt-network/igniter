'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { BellIcon } from 'lucide-react'
import { Button } from '../button'
import { cn } from '../../lib/utils'

export type NotificationSeverity = 'error' | 'warning' | 'info' | 'success'

export interface BellNotification {
  /** Stable key — the event uuid. */
  uuid: string
  severity: NotificationSeverity
  /** Bold heading, e.g. "Suppliers Staked". */
  title: string
  /** One-line detail under the title. */
  description?: string
  createdAt: Date | string
  /**
   * Marks the event read. Only invoked from the card's ✕ — opening the panel or
   * letting the card scroll out of view never marks anything read.
   * Must reject if the mark-read did not persist: the card then re-expands
   * instead of staying collapsed over an event that is still unread.
   */
  onDismiss: () => void | Promise<void>
  /** Optional deep-link; renders an action button on the card. */
  onOpen?: () => void
  openLabel?: string
}

export interface NotificationBellProps {
  notifications: Array<BellNotification>
  /**
   * True unread total. `notifications` is capped by the feed (6), so this can
   * exceed the list length — the stack says so beneath the last card.
   */
  unreadCount: number
  onMarkAllRead?: () => void | Promise<void>
  onViewAll?: () => void
  className?: string
}

// Severity → token classes. Mirrors the `badge.tsx` variant map so severity reads
// the same everywhere. There is no `--info` foreground token; info borrows
// `--accent` (the same substitution `badge.tsx` makes).
const SEVERITY_STYLES: Record<NotificationSeverity, { bar: string; tint: string; text: string }> = {
  success: { bar: 'bg-success', tint: 'bg-success-bg', text: 'text-success' },
  warning: { bar: 'bg-warning', tint: 'bg-warning-bg', text: 'text-warning' },
  error: { bar: 'bg-error', tint: 'bg-error-bg', text: 'text-error' },
  info: { bar: 'bg-accent', tint: 'bg-info-bg', text: 'text-accent' },
}

// Exit transition duration. The card is removed from the DOM by the parent only
// after `onDismiss` resolves, so this is purely the local collapse animation
// window — keep it in sync with the `duration-200` class below.
const EXIT_MS = 200

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
  return sameDay ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`
}

function NotificationCard({
  notification,
  exiting,
  onRequestDismiss,
}: {
  notification: BellNotification
  exiting: boolean
  onRequestDismiss: () => void
}) {
  const styles = SEVERITY_STYLES[notification.severity] ?? SEVERITY_STYLES.info

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border-subtle bg-bg-elevated shadow-lg',
        // Collapsing max-height + margin is what makes the cards below slide up
        // into the freed slot instead of jumping.
        'transition-all duration-200 ease-out max-h-[320px] mb-2',
        exiting && 'max-h-0 mb-0 opacity-0 translate-x-4 border-transparent',
      )}
    >
      {/* Severity tint sits above the elevated surface so the token rgba reads as a wash. */}
      <span aria-hidden className={cn('pointer-events-none absolute inset-0', styles.tint)} />
      <span aria-hidden className={cn('absolute left-0 top-0 h-full w-[3px]', styles.bar)} />

      <div className="relative flex gap-3 py-3 pl-4 pr-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary">{notification.title}</p>
          {notification.description && (
            <p className="mt-0.5 text-sm text-text-secondary break-words">{notification.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <p className={cn('text-xs', styles.text)}>{formatTimestamp(notification.createdAt)}</p>
            {notification.onOpen && (
              <button
                type="button"
                className="text-xs text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus rounded-sm"
                onClick={notification.onOpen}
              >
                {notification.openLabel ?? 'View'}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          aria-label="Mark as read"
          title="Mark as read"
          className="h-6 w-6 shrink-0 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
          onClick={onRequestDismiss}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Bell button that toggles a free-floating stack of notification cards under the
 * topbar. Newest renders at the top. Nothing appears on screen until the bell is
 * clicked; arrival of a new event only moves the badge count. Clicking the bell
 * again, Escape, or navigating to another route hides the stack without marking
 * anything read — only a card's ✕ does that.
 *
 * Presentational only — the caller supplies the events and the mark-read
 * side-effects, so both apps can share it despite different data sources.
 */
export function NotificationBell({
  notifications,
  unreadCount,
  onMarkAllRead,
  onViewAll,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false)
  const [exiting, setExiting] = React.useState<ReadonlySet<string>>(new Set())
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])
  const pathname = usePathname()

  // The stack is fixed-position, so leaving it open across a navigation parks it
  // over whatever page the user just opened. Closing hides nothing permanently —
  // the badge still carries the count and nothing here is marked read.
  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  React.useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
    },
    [],
  )

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Drop stale exit flags once the parent's list no longer contains them, so a
  // uuid that re-appears (mark-read failed and the poll re-surfaced it) is not
  // stuck invisible.
  React.useEffect(() => {
    setExiting((prev) => {
      if (prev.size === 0) return prev
      const live = new Set(notifications.map((n) => n.uuid))
      const next = new Set([...prev].filter((uuid) => live.has(uuid)))
      return next.size === prev.size ? prev : next
    })
  }, [notifications])

  const handleDismiss = (notification: BellNotification) => {
    if (exiting.has(notification.uuid)) return
    setExiting((prev) => new Set(prev).add(notification.uuid))
    // Let the collapse play, then persist. The parent re-renders without the
    // card once the mark-read invalidation lands.
    timers.current.push(
      setTimeout(() => {
        void Promise.resolve(notification.onDismiss()).catch(() => {
          // Persisting failed — the event is still unread and will come back on
          // the next poll, so re-expand rather than leaving a collapsed ghost.
          setExiting((prev) => {
            const next = new Set(prev)
            next.delete(notification.uuid)
            return next
          })
        })
      }, EXIT_MS),
    )
  }

  // A card's action navigates, and the pathname effect above closes the stack for
  // it — except when the target differs only by search params (the provider's
  // ?uuid= deep-link, opened from the notifications page itself). Close here too,
  // so the drawer it opens is never covered by the cards that opened it.
  const cards = React.useMemo(
    () =>
      notifications.map((n) =>
        n.onOpen
          ? {
              ...n,
              onOpen: () => {
                setOpen(false)
                n.onOpen!()
              },
            }
          : n,
      ),
    [notifications],
  )

  // The caller's count comes from a separate query than the list; if that query
  // fails it reports 0 while cards are still on screen, which would hide the
  // badge, the summary line and mark-all. The list is a floor for the count.
  const totalUnread = Math.max(unreadCount, notifications.length)
  const badge = totalUnread > 99 ? '99+' : String(totalUnread)
  const linkClass =
    'text-xs text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-border-focus rounded-sm'

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative', className)}
        aria-label={totalUnread > 0 ? `Notifications (${totalUnread} unread)` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon className="size-[18px]" />
        {totalUnread > 0 && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center',
              'rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white',
            )}
          >
            {badge}
          </span>
        )}
      </Button>

      {/* Free-floating stack rather than a panel: the bell is a pure toggle, and
          the cards read as toasts hanging under the topbar. Clicking the bell
          again hides them; only ✕ marks anything read. */}
      {open && (
        <div
          className={cn(
            'fixed right-4 top-[calc(var(--header-height)+0.5rem)] z-[60]',
            'flex w-[380px] max-w-[calc(100vw-2rem)] flex-col',
            'max-h-[calc(100dvh-var(--header-height)-2rem)] overflow-y-auto scrollbar-hidden',
            'animate-in fade-in-0 slide-in-from-top-2 duration-200',
          )}
        >
          {notifications.length === 0 ? (
            <div className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-3 shadow-lg">
              {/* The count and the list are separate queries. If the list fails
                  while the count succeeds, "all caught up" would contradict the
                  badge the user just clicked. */}
              <p className="text-sm text-text-tertiary">
                {totalUnread > 0
                  ? 'Notifications could not be loaded. Try again in a moment.'
                  : "You're all caught up."}
              </p>
            </div>
          ) : (
            cards.map((notification) => (
              <NotificationCard
                key={notification.uuid}
                notification={notification}
                exiting={exiting.has(notification.uuid)}
                onRequestDismiss={() => handleDismiss(notification)}
              />
            ))
          )}

          {/* Also when the list is empty but the badge is not: those controls are
              the only way out of a failed list, so gating them on the list alone
              would strand the user on an empty panel. */}
          {(onMarkAllRead || onViewAll) && (notifications.length > 0 || totalUnread > 0) && (
            <div className="flex items-center justify-end gap-4 px-1 pb-1">
              {totalUnread > notifications.length && (
                <span className="mr-auto text-xs text-text-tertiary">
                  Showing {notifications.length} of {totalUnread} unread
                </span>
              )}
              {onMarkAllRead && totalUnread > 0 && (
                <button
                  type="button"
                  className={linkClass}
                  onClick={() => void Promise.resolve(onMarkAllRead()).catch(() => {})}
                >
                  Mark all as read
                </button>
              )}
              {onViewAll && (
                <button
                  type="button"
                  className={linkClass}
                  onClick={() => {
                    setOpen(false)
                    onViewAll()
                  }}
                >
                  View all
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default NotificationBell
