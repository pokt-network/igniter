'use client'

import React from 'react'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import type { ColumnDef } from '@igniter/ui/components/table'
import { ratio, toBig } from '@/lib/analytics/math'
import { moneyCsvColumns, ratioString, vsEqualShareString, type CsvColumn } from '@/lib/analytics/csv'
import { formatCount, formatPercent, Pokt } from './format'

/** Numbers sit right-aligned, header included, so digits line up down a column. */
export function Num({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <div className={`text-right font-mono whitespace-nowrap ${muted ? 'text-text-tertiary' : ''}`}>{children}</div>
}

export const VS_EQUAL_SHARE_HELP =
  'How your actual earnings compare with an equal split of each session’s pool over its roster: −30% means you earned 0.70 of your equal share.'

export function HeaderWithHelp({ label, help, align = 'right' }: { label: string; help: string; align?: 'left' | 'right' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'justify-end w-full' : ''}`}>
      {label}
      <span className="normal-case tracking-normal font-normal">
        <QuickInfoPopOverIcon title={label} description={help} url="" />
      </span>
    </span>
  )
}

/** Actual against equal share as a signed %, the ratio in the hover title. */
export function VsEqualShare({ y, b }: { y: string; b: string }) {
  const f = ratio(toBig(y), toBig(b))
  if (f === null) return <Num muted>—</Num>
  const pct = (f - 1) * 100
  return (
    <div className={`text-right font-mono whitespace-nowrap ${pct < 0 ? 'text-text-secondary' : ''}`} title={`Actual ÷ equal share: ${f.toFixed(3)}`}>
      {formatPercent(pct)}
    </div>
  )
}

type MoneyRow = { y: string; b: string; sessions: number }

/**
 * The columns every Analytics group table shares after its first one: Actual, Equal share, vs equal share, Sessions;
 * with their CSV form (exact POKT, the ratio and the %).
 */
export function moneyColumns<T extends MoneyRow>(): Array<ColumnDef<T> & Partial<CsvColumn<T>>> {
  const [y, b] = moneyCsvColumns<T>()
  return [
    { ...y!, header: () => <div className="text-right">Actual</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <Num><Pokt upokt={row.original.y} /></Num> },
    { ...b!, header: () => <div className="text-right">Equal share</div>, meta: { headerAlign: 'right' }, cell: ({ row }) => <Num><Pokt upokt={row.original.b} /></Num> },
    {
      id: 'vsEqualShare',
      accessorKey: 'vsEqualShare' as keyof T & string,
      csvHeader: 'vs equal share (%)',
      csvFormatterFn: (r: T) => vsEqualShareString(r.y, r.b),
      header: () => <HeaderWithHelp label="vs equal share" help={VS_EQUAL_SHARE_HELP} />,
      meta: { headerAlign: 'right' },
      cell: ({ row }) => <VsEqualShare y={row.original.y} b={row.original.b} />,
    },
    {
      id: 'ratio',
      accessorKey: 'ratio' as keyof T & string,
      csvHeader: 'Actual ÷ equal share',
      csvFormatterFn: (r: T) => ratioString(r.y, r.b),
      header: () => <div className="text-right">Actual ÷ equal share</div>,
      meta: { headerAlign: 'right' },
      cell: ({ row }) => {
        const f = ratio(toBig(row.original.y), toBig(row.original.b))
        return <Num muted={f === null}>{f === null ? '—' : f.toFixed(2)}</Num>
      },
    },
    {
      accessorKey: 'sessions' as keyof T & string,
      csvHeader: 'Sessions',
      csvFormatterFn: (r: T) => String(r.sessions),
      header: () => <div className="text-right">Sessions</div>,
      meta: { headerAlign: 'right' },
      cell: ({ row }) => <Num>{formatCount(row.original.sessions)}</Num>,
    },
  ] as Array<ColumnDef<T> & Partial<CsvColumn<T>>>
}
