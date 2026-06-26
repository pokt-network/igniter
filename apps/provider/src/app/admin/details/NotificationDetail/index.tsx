'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { NotificationChannelIcon } from '@/components/NotificationChannelIcon'
import { DrawerDescription, DrawerHeader, DrawerTitle } from '@igniter/ui/components/drawer'
import Summary, { type SummaryRow } from '@igniter/ui/components/Summary'
import Address from '@igniter/ui/components/Address'
import { CaretSmallIcon, CopyIcon, CheckSuccess } from '@igniter/ui/assets'
import { Button } from '@igniter/ui/components/button'
import { copyToClipboard } from '@igniter/ui/lib/utils'
import { useRemoveLastItemFromDetail } from '@igniter/ui/components/QuickDetails/Provider'
import type {
  NotificationEvent,
  NotificationEventMetadata,
  NotificationEventChannel,
} from '@igniter/db/provider/schema'
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_GRADIENT,
  REMEDIATION_REASON_LABELS,
} from '@/lib/constants'

export interface NotificationDetail {
  type: 'notification'
  body: NotificationEvent
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function n(count: number, noun: string) {
  return `${count} ${noun}${count !== 1 ? 's' : ''}`
}

function getBannerMetric(meta: NotificationEventMetadata | null | undefined): string {
  if (!meta) return ''
  if ('addresses' in meta) return meta.addresses.length.toLocaleString()
  if ('byReason' in meta) {
    const { s, f } = Object.values(meta.byReason).reduce(
      (acc, { succeeded, failed }) => ({ s: acc.s + succeeded.length, f: acc.f + failed.length }),
      { s: 0, f: 0 },
    )
    return `✔ ${s} · ✕ ${f}`
  }
  if ('inserted' in meta) {
    return n(meta.inserted + meta.updated + meta.disabled, 'change')
  }
  return ''
}

function getBlockHeight(meta: NotificationEventMetadata | null | undefined): number | null {
  if (!meta) return null
  if ('addresses' in meta) return meta.height
  if ('byReason' in meta) return meta.height
  return null
}

// ─── UUID copy button ─────────────────────────────────────────────────────────

function CopyUuidButton({ uuid }: { uuid: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = () => {
    copyToClipboard(uuid).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1000)
    })
  }

  return (
    <Button variant="icon" className="h-5 shrink-0" onClick={handleCopy}>
      {isCopied ? <CheckSuccess /> : <CopyIcon style={{ marginTop: '4px' }} />}
    </Button>
  )
}

function ErrorBlock({ error }: { error: string }) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = () => {
    copyToClipboard(error).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1000)
    })
  }

  return (
    <div className="rounded-[6px] bg-red-950/30 border border-red-500/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-red-500/20">
        <span className="text-[10px] font-medium text-red-400/60 uppercase tracking-widest">Error</span>
        <Button variant="icon" className="h-5 shrink-0" onClick={handleCopy}>
          {isCopied ? <CheckSuccess /> : <CopyIcon style={{ marginTop: '4px' }} />}
        </Button>
      </div>
      <pre className="px-3 py-2 text-xs text-red-300/80 font-mono whitespace-pre-wrap break-all leading-relaxed">{error}</pre>
    </div>
  )
}

// ─── Metadata sections ───────────────────────────────────────────────────────

function AddressesSection({
  addresses,
  onAddressClick,
}: {
  addresses: string[]
  onAddressClick: (address: string) => void
}) {
  const INITIAL_LIMIT = 5
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? addresses : addresses.slice(0, INITIAL_LIMIT)
  const hasMore = addresses.length > INITIAL_LIMIT

  return (
    <div className="flex flex-col bg-bg-elevated rounded-[8px]">
      <div className="text-[12px] text-text-secondary p-[8px_12px] flex items-center justify-between">
        <span>
          {n(addresses.length, 'supplier')}
        </span>
      </div>
      <div className="flex flex-col">
        {visible.map((addr) => (
          <div
            key={addr}
            className="px-3 py-2 border-t border-border-primary first:border-t-0"
          >
            <Address address={addr} onClick={() => onAddressClick(addr)} />
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="px-3 py-2 border-t border-border-primary text-xs text-text-tertiary hover:text-text-primary text-left"
        >
          {showAll ? 'Show less' : `Show ${addresses.length - INITIAL_LIMIT} more…`}
        </button>
      )}
    </div>
  )
}

function RemediationSection({
  byReason,
  onAddressClick,
}: {
  byReason: Record<string, { succeeded: string[]; failed: string[] }>
  onAddressClick: (address: string) => void
}) {
  const entries = Object.entries(byReason).filter(
    ([, { succeeded, failed }]) => succeeded.length > 0 || failed.length > 0,
  )
  const [expandedReasons, setExpandedReasons] = useState<Record<string, boolean>>({})

  const toggleReason = (reason: string) =>
    setExpandedReasons((prev) => ({ ...prev, [reason]: !prev[reason] }))

  return (
    <div className="flex flex-col bg-bg-elevated rounded-[8px]">
      {entries.map(([reason, { succeeded, failed }], index) => {
        const label = REMEDIATION_REASON_LABELS[reason] ?? reason
        const total = succeeded.length + failed.length
        const isExpanded = expandedReasons[reason] ?? false

        return (
          <div key={reason} className={clsx("border-border-primary", index !== 0 && 'border-t')}>
            <div
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-bg-surface"
              onClick={() => toggleReason(reason)}
            >
              <span className="flex items-center gap-2 text-sm">
                <span className="flex items-center justify-center">
                  <CaretSmallIcon
                    style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
                  />
                </span>
                <span>{label}</span>
                <span className="text-xs text-text-tertiary">({total})</span>
              </span>
              <span className="text-xs text-text-tertiary flex items-center gap-2">
                {succeeded.length > 0 && (
                  <span className="text-green-400">✓ {succeeded.length}</span>
                )}
                {failed.length > 0 && (
                  <span className="text-red-400">✗ {failed.length}</span>
                )}
              </span>
            </div>

            {isExpanded && (
              <div className="flex flex-col border-t border-border-primary">
                {succeeded.length > 0 && (
                  <div className="px-3 py-2 flex flex-col gap-1.5">
                    <p className="text-xs text-text-tertiary mb-0.5">✓ Succeeded ({succeeded.length})</p>
                    {succeeded.map((addr) => (
                      <Address key={addr} address={addr} onClick={() => onAddressClick(addr)} />
                    ))}
                  </div>
                )}
                {failed.length > 0 && (
                  <div className={clsx('px-3 py-2 flex flex-col gap-1.5', succeeded.length > 0 && 'border-t border-border-primary')}>
                    <p className="text-xs text-text-tertiary mb-0.5">✗ Failed ({failed.length})</p>
                    {failed.map((addr) => (
                      <Address key={addr} address={addr} onClick={() => onAddressClick(addr)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DelegatorsSection({
  inserted,
  updated,
  disabled,
}: {
  inserted: number
  updated: number
  disabled: number
}) {
  const rows = [
    { icon: '+', color: 'text-green-400', label: 'Added', value: inserted },
    { icon: '~', color: 'text-yellow-400', label: 'Updated', value: updated },
    { icon: '−', color: 'text-red-400', label: 'Disabled', value: disabled },
  ].filter((r) => r.value > 0)

  return (
    <div className="flex flex-col bg-bg-elevated rounded-[8px]">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between px-3 py-2.5 border-t border-border-primary first:border-t-0"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx('font-mono font-bold w-4 shrink-0', row.color)}>
              {row.icon}
            </span>
            <span className="text-text-secondary">{row.label}</span>
          </div>
          <span className="font-mono text-sm">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

function MetadataView({
  metadata,
  onAddressClick,
}: {
  metadata: NotificationEventMetadata
  onAddressClick: (address: string) => void
}) {
  if ('addresses' in metadata) {
    return (
      <AddressesSection
        addresses={metadata.addresses}
        onAddressClick={onAddressClick}
      />
    )
  }

  if ('byReason' in metadata) {
    return (
      <RemediationSection
        byReason={metadata.byReason}
        onAddressClick={onAddressClick}
      />
    )
  }

  if ('inserted' in metadata) {
    return (
      <DelegatorsSection
        inserted={metadata.inserted}
        updated={metadata.updated}
        disabled={metadata.disabled}
      />
    )
  }

  return null
}

export default function NotificationDetailCard(event: NotificationEvent) {
  const router = useRouter()
  const removeLastItem = useRemoveLastItemFromDetail()
  const title = NOTIFICATION_EVENT_LABELS[event.type as keyof typeof NOTIFICATION_EVENT_LABELS] ?? event.type
  const borderClass = NOTIFICATION_EVENT_GRADIENT[event.type as keyof typeof NOTIFICATION_EVENT_GRADIENT] ?? 'gradient-border-slate'
  const metric = getBannerMetric(event.metadata)
  const blockHeight = getBlockHeight(event.metadata)
  const channels = (event.channels ?? []) as NotificationEventChannel[]
  const hasChannelErrors = channels.some((c) => c.status === 'error')

  const [channelsExpanded, setChannelsExpanded] = useState(hasChannelErrors)

  const handleAddressClick = (address: string) => {
    removeLastItem()
    router.push(`/admin/keys?address=${encodeURIComponent(address)}`)
  }

  const summaryRows: SummaryRow[] = [
    {
      label: 'ID',
      value: (
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-text-secondary truncate">{event.uuid}</span>
          <CopyUuidButton uuid={event.uuid} />
        </div>
      ),
    },
    ...(
      blockHeight ? [
        {
          label: 'Block',
          value: (
            <span className={'font-mono text-sm'}>{blockHeight}</span>
          )
        },
      ] :
        []
    ),
    {
      label: 'Sent At',
      value: (
        <span className="font-mono text-sm">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      ),
    }
  ]

  return (
    <div className="gap-6 flex flex-col">
      <DrawerHeader className="p-0 gap-1">
        <DrawerTitle className="text-2xl font-normal">Notification Event</DrawerTitle>
        <DrawerDescription className="text-sm">{title}</DrawerDescription>
      </DrawerHeader>

      <div className={clsx('relative flex h-[64px] mt-[-5px]', borderClass)}>
        <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
          <span className="text-[18px] text-text-secondary">{title}</span>
          <div className="flex flex-col items-end">
            {metric && (
              <span className="font-mono text-[18px]">{metric}</span>
            )}
          </div>
        </div>
      </div>

      <Summary rows={summaryRows} />

      {channels.length > 0 && (
        <div className="flex flex-col gap-3">
          <span
            className="flex items-center gap-2 cursor-pointer w-fit"
            onClick={() => setChannelsExpanded((prev) => !prev)}
          >
            <span className="flex items-center justify-center">
              <CaretSmallIcon
                style={{ transform: channelsExpanded ? 'rotate(90deg)' : undefined }}
              />
            </span>
            <span className="text-sm">Channels ({channels.length})</span>
            {hasChannelErrors && (
              <span className="text-xs text-red-400">
                · {channels.filter((c) => c.status === 'error').length} failed
              </span>
            )}
          </span>

          {channelsExpanded && (
            <div className="flex flex-col gap-2">
              {channels.map((c) => {
                const isError = c.status === 'error'
                return (
                  <div key={c.id} className="flex flex-col gap-1">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1.5 text-xs rounded px-2 py-1 w-fit',
                        isError
                          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                          : 'bg-bg-surface border border-border-subtle text-text-secondary',
                      )}
                    >
                      <NotificationChannelIcon type={c.type} className="h-3.5 w-3.5 shrink-0" />
                      {c.name}
                      <span className={clsx('font-mono ml-0.5', isError ? 'text-red-400' : 'text-green-400')}>
                        {isError ? '✗' : '✓'}
                      </span>
                    </span>
                    {isError && c.error && (
                      <ErrorBlock error={c.error} />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {event.metadata && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Details</span>
          <MetadataView
            metadata={event.metadata}
            onAddressClick={handleAddressClick}
          />
        </div>
      )}
    </div>
  )
}
