'use client'

import React from 'react'
import { ArrowRight, Plus } from 'lucide-react'

/*
 * The Analytics page's building blocks, in the shape of @mykyal's fleet analysis (cards, eyebrows, badges, text
 * actions, a collapsible details panel) with igniter's colours.
 */

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-border-primary bg-bg-surface p-6 ${className}`}>{children}</section>
}

export function Eyebrow({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${muted ? 'text-text-tertiary' : 'text-accent'}`}>
      {children}
    </div>
  )
}

export function Badge({ children, tone = 'accent' }: { children: React.ReactNode; tone?: 'accent' | 'warning' | 'muted' }) {
  const colours = {
    accent: 'bg-accent/10 text-accent',
    warning: 'bg-warning-bg text-warning',
    muted: 'bg-bg-elevated text-text-secondary',
  }[tone]
  return <span className={`inline-flex items-center rounded-[5px] px-2 py-1 text-[11px] font-semibold leading-snug whitespace-nowrap ${colours}`}>{children}</span>
}

export function CardDivider({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 pt-4 border-t border-border-primary">{children}</div>
}

export function TextAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-accent hover:underline">
      {children} <ArrowRight className="h-4 w-4" />
    </button>
  )
}

/** A collapsed panel, like the site's "Exact amounts and group evidence". */
export function DetailsPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border-primary bg-bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
        {title}
        <Plus className="h-4 w-4 text-text-tertiary transition-transform group-open:rotate-45" />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayParts = (day: string) => ({ d: Number(day.slice(8, 10)), m: MONTHS[Number(day.slice(5, 7)) - 1], y: day.slice(0, 4) })

/** 6 Sep – 5 Oct 2026; 19 – 25 Oct 2026 within a month; the year on both ends when they differ. */
export function periodLabel(from?: string, to?: string): string {
  if (!from || !to) return ''
  const a = dayParts(from)
  const b = dayParts(to)
  if (from === to) return `${b.d} ${b.m} ${b.y}`
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`
  if (a.m === b.m) return `${a.d} – ${b.d} ${b.m} ${b.y}`
  return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`
}

/**
 * A CSV file name that says what it holds: `<base>_<from>_<to>`, plus `_<n>svc` when a services filter is set. The
 * export appends its own date and time.
 */
export function csvName(base: string, period: { from: string; to: string }, services: string[] | null): string {
  return `${base}_${period.from}_${period.to}${services && services.length > 0 ? `_${services.length}svc` : ''}`
}

/** Days in [from, to], both included. */
export function periodDays(from?: string, to?: string): number {
  if (!from || !to) return 0
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}
