'use client'

import React from 'react'
import { DrawerDescription, DrawerHeader, DrawerTitle } from '@igniter/ui/components/drawer'
import Summary, { SummaryRow } from '@igniter/ui/components/Summary'
import Address from '@igniter/ui/components/Address'
import TransactionHash from '@igniter/ui/components/TransactionHash'
import { Badge } from '@igniter/ui/components/badge'
import type { Transaction } from '@igniter/db/provider/schema'
import { TransactionStatus } from '@igniter/db/provider/enums'
import {
  StatusLabels,
  TypeLabels,
  ReasonLabels,
  TriggerLabels,
} from '@/app/admin/(internal)/transactions/table/columns'

const statusVariant: Record<string, 'warning' | 'success' | 'destructive'> = {
  [TransactionStatus.Pending]: 'warning',
  [TransactionStatus.Success]: 'success',
  [TransactionStatus.Failure]: 'destructive',
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatHeight(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

interface ParamsSummaryProps {
  params: string | null | undefined
}

function ParamsSummary({ params }: ParamsSummaryProps) {
  if (!params) return <span className="font-mono text-text-tertiary">—</span>

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(params)
  } catch {
    return (
      <span className="font-mono text-xs text-text-tertiary break-all">
        {params.slice(0, 80)}{params.length > 80 ? '…' : ''}
      </span>
    )
  }

  const keys = Object.keys(parsed)
  if (keys.length === 0) return <span className="font-mono text-text-tertiary">—</span>

  return (
    <div className="flex flex-col gap-1 text-xs font-mono text-text-secondary">
      {keys.slice(0, 6).map((key) => {
        const val = parsed[key]
        const display =
          val == null
            ? '—'
            : typeof val === 'object'
            ? JSON.stringify(val).slice(0, 40) + (JSON.stringify(val).length > 40 ? '…' : '')
            : String(val).slice(0, 40) + (String(val).length > 40 ? '…' : '')
        return (
          <div key={key} className="flex flex-row gap-2 justify-between">
            <span className="text-text-tertiary shrink-0">{key}</span>
            <span className="text-right break-all">{display}</span>
          </div>
        )
      })}
      {keys.length > 6 && (
        <span className="text-text-tertiary">+{keys.length - 6} more</span>
      )}
    </div>
  )
}

interface ReasonsSummaryProps {
  reasons: string | null | undefined
}

function ReasonsSummary({ reasons }: ReasonsSummaryProps) {
  if (!reasons) return <span className="font-mono text-text-tertiary">—</span>

  let parsed: string[]
  try {
    parsed = JSON.parse(reasons)
  } catch {
    return <span className="font-mono text-text-tertiary text-xs">{reasons}</span>
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return <span className="font-mono text-text-tertiary">—</span>
  }

  return (
    <div className="flex flex-col gap-1 text-xs font-mono text-text-secondary">
      {parsed.map((r, i) => (
        <span key={i}>{ReasonLabels[r] || r}</span>
      ))}
    </div>
  )
}

interface TransactionDetailProps {
  tx: Transaction
}

export default function TransactionDetail({ tx }: TransactionDetailProps) {
  const {
    hash,
    keyAddress,
    type,
    status,
    reason,
    trigger,
    executionHeight,
    lastCoveredHeight,
    timeoutHeight,
    timeoutTimestamp,
    unavailableChecks,
    lastVerificationAt,
    createdAt,
    reasons,
    params,
  } = tx

  const variant = statusVariant[status] ?? 'warning'

  const rows: Array<SummaryRow> = [
    {
      label: 'Tx Hash',
      value: hash
        ? <TransactionHash hash={hash} />
        : <span className="font-mono text-text-tertiary">—</span>,
    },
    {
      label: 'Supplier',
      value: <Address address={keyAddress} />,
    },
    {
      label: 'Type',
      value: <span>{TypeLabels[type] || type}</span>,
    },
    {
      label: 'Status',
      value: <Badge variant={variant}>{StatusLabels[status] || status}</Badge>,
    },
    {
      label: 'Remediation',
      value: <span>{reason ? (ReasonLabels[reason] || reason) : '—'}</span>,
    },
    {
      label: 'Trigger',
      value: <span>{trigger ? (TriggerLabels[trigger] || trigger) : '—'}</span>,
    },
    {
      label: 'Execution Height',
      value: <span className="font-mono">{formatHeight(executionHeight)}</span>,
    },
    {
      label: 'Last Covered Height',
      value: <span className="font-mono">{formatHeight(lastCoveredHeight)}</span>,
    },
    {
      label: 'Timeout Height',
      value: <span className="font-mono">{formatHeight(timeoutHeight)}</span>,
    },
    {
      label: 'Timeout Timestamp',
      value: <span className="font-mono">{formatDate(timeoutTimestamp)}</span>,
    },
    {
      label: 'Unavailable Checks',
      value: <span className="font-mono">{unavailableChecks || '—'}</span>,
    },
    {
      label: 'Last Verification',
      value: <span className="font-mono">{formatDate(lastVerificationAt)}</span>,
    },
    {
      label: 'Created At',
      value: <span className="font-mono">{formatDate(createdAt)}</span>,
    },
  ]

  return (
    <div className="gap-6 flex flex-col">
      <DrawerHeader className="p-0 gap-1">
        <DrawerTitle className="text-2xl font-normal">
          {TypeLabels[type] || type} Transaction
        </DrawerTitle>
        <DrawerDescription className="text-sm">
          Provider transaction details and verification status
        </DrawerDescription>
      </DrawerHeader>

      <div className="relative flex h-[64px] mt-[-5px] gradient-border-slate">
        <div className="absolute inset-0 flex flex-row items-center bg-bg-root rounded-[8px] p-[18px_25px] justify-between">
          <span className="text-[20px] text-text-secondary">
            {TypeLabels[type] || type}
          </span>
          <Badge variant={variant} className="text-sm px-3 py-1">
            {StatusLabels[status] || status}
          </Badge>
        </div>
      </div>

      <Summary rows={rows} />

      {(reasons || params) && (
        <div className="flex flex-col gap-4">
          {reasons && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                Reasons
              </span>
              <div className="flex flex-col bg-bg-elevated rounded-[8px] p-[8px_12px]">
                <ReasonsSummary reasons={reasons} />
              </div>
            </div>
          )}
          {params && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                Params
              </span>
              <div className="flex flex-col bg-bg-elevated rounded-[8px] p-[8px_12px]">
                <ParamsSummary params={params} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
