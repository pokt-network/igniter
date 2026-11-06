import Amount from '@igniter/ui/components/Amount'
import { amountToPokt, toCurrencyFormat } from '@igniter/ui/lib/utils'

/** An upokt amount (string) as $POKT, with the app's formatter. */
export function Pokt({ upokt, digits = 2 }: { upokt: string | null | undefined; digits?: number }) {
  if (upokt === null || upokt === undefined) return <span className="text-text-tertiary">-</span>
  return <Amount value={amountToPokt(upokt)} maxFractionDigits={digits} minimumFractionDigits={digits} />
}

export const poktNumber = (upokt: string | null | undefined) => amountToPokt(upokt ?? 0)

export function formatF(f: number | null | undefined): string {
  return f === null || f === undefined ? '-' : f.toFixed(2)
}

export function formatPercent(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined) return '-'
  return `${p > 0 ? '+' : ''}${p.toFixed(digits)}%`
}

export function formatShare(share: number | null | undefined): string {
  return share === null || share === undefined ? '-' : `${(share * 100).toFixed(1)}%`
}

export const formatCount = (n: number | null | undefined) => (n === null || n === undefined ? '-' : toCurrencyFormat(n, 0))

/** A UTC day for display: 24 Oct 2026. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '-'
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const gb = (n: number, digits: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** upokt (string) to POKT as a number: display only, never summed back. */
export const toPokt = (upokt: string | null | undefined) => Number(upokt ?? 0) / 1e6

/** 3,635,138.9 POKT */
export function poktText(upokt: string | null | undefined, digits = 1): string {
  if (upokt === null || upokt === undefined) return '—'
  return `${gb(toPokt(upokt), digits)} POKT`
}

/** A signed percentage with a true minus: −35.7%, +3.0%, ≈0.0% when it rounds to zero. */
export function signedPercent(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined) return '—'
  if (Math.abs(p) < 10 ** -digits / 2) return `≈${gb(0, digits)}%`
  return `${p > 0 ? '+' : '−'}${gb(Math.abs(p), digits)}%`
}

/** The difference versus equal share of an actual/equal-share pair, in %: (Y ÷ B − 1) × 100, or null without B. */
export function differencePercent(y: string, b: string): number | null {
  const bn = Number(b)
  return bn > 0 ? (Number(y) / bn - 1) * 100 : null
}

/** Actual ÷ equal share, two decimals. */
export function ratioText(y: string, b: string): string {
  const bn = Number(b)
  return bn > 0 ? (Number(y) / bn).toFixed(2) : '—'
}

export const countText = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : gb(n, digits))
