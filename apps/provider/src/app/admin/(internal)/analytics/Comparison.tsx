'use client'

import React from 'react'
import { countText, differencePercent, poktText, ratioText, signedPercent, toPokt } from './format'

/*
 * The two chart shapes of the Analytics page, drawn in SVG: one row per group with its difference versus equal share
 * on a shared scale centred at 0 (or its two amounts on a shared POKT scale), and a time chart of actual against
 * equal share. Colours come from the theme: the accent for actual and above, the warning tone for below, the muted
 * text for equal share.
 */

export type ComparisonRow = {
  key: string
  label: React.ReactNode
  /** A short line under the label, such as "30 days with data". */
  note?: React.ReactNode
  y: string
  b: string
}

export type ComparisonMetric = 'difference' | 'amounts'

const tone = (pct: number | null) => (pct !== null && pct < 0 ? 'var(--warning)' : 'var(--accent)')

/** The shared scale's half width: the largest difference (at least 10%), with 10% of room. */
export function sharedExtent(rows: Array<{ y: string; b: string }>): number {
  return Math.max(10, ...rows.map((r) => Math.abs(differencePercent(r.y, r.b) ?? 0))) * 1.1
}

export function ComparisonRows({
  rows,
  metric = 'difference',
  onSelect,
}: {
  rows: ComparisonRow[]
  metric?: ComparisonMetric
  onSelect?: (key: string) => void
}) {
  const extent = sharedExtent(rows)
  const maximum = Math.max(1, ...rows.flatMap((r) => [toPokt(r.y), toPokt(r.b)]))
  const pos = (value: number) => (metric === 'amounts' ? 8 + (value / maximum) * 284 : 150 + (value / extent) * 142)

  return (
    <div className="flex flex-col">
      <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 mt-6 mb-2 text-xs text-text-secondary">
        {metric === 'amounts' ? (
          <>
            <Key color="var(--accent)">Actual earnings</Key>
            <Key color="var(--text-tertiary)">Equal-share amount</Key>
            <span className="ml-auto text-[11px] text-text-tertiary">Shared scale · 0 to {countText(maximum, 1)} POKT</span>
          </>
        ) : (
          <>
            <span>Difference versus equal share</span>
            <span className="ml-auto text-[11px] text-text-tertiary">
              Shared scale · {signedPercent(-extent, 0)} to {signedPercent(extent, 0)} · centre = 0%
            </span>
          </>
        )}
      </div>
      {rows.map((r) => {
        const pct = differencePercent(r.y, r.b)
        const colour = tone(pct)
        const Row = onSelect ? 'button' : 'div'
        return (
          <Row
            key={r.key}
            type={onSelect ? 'button' : undefined}
            onClick={onSelect ? () => onSelect(r.key) : undefined}
            className={`grid grid-cols-[minmax(110px,.85fr)_minmax(110px,1.8fr)_minmax(96px,120px)] items-center gap-4 md:gap-6 min-h-[76px] py-3 px-1.5 border-t border-border-subtle text-left w-full ${onSelect ? 'hover:bg-bg-hover cursor-pointer' : ''}`}
          >
            <span className="min-w-0 break-words text-sm font-medium text-text-primary">
              {r.label}
              {r.note && <small className="block mt-1 text-[11px] font-normal text-text-tertiary">{r.note}</small>}
            </span>
            <span className="flex flex-col gap-1 min-w-0">
              <svg viewBox="0 0 300 36" className="w-full h-[38px]" aria-hidden="true">
                <line x1="8" x2="292" y1="18" y2="18" stroke="var(--border-subtle)" strokeWidth="3" />
                {metric === 'amounts' ? (
                  <>
                    <line x1={pos(Math.min(toPokt(r.y), toPokt(r.b)))} x2={pos(Math.max(toPokt(r.y), toPokt(r.b)))} y1="18" y2="18" stroke="var(--border-primary)" strokeWidth="3" />
                    <circle cx={pos(toPokt(r.b))} cy="18" r="5" fill="var(--text-tertiary)" />
                    <circle cx={pos(toPokt(r.y))} cy="18" r="5" fill="var(--accent)" />
                  </>
                ) : (
                  <>
                    <line x1="150" x2="150" y1="4" y2="32" stroke="var(--text-tertiary)" strokeDasharray="3 3" />
                    {pct !== null && (
                      <>
                        <line x1="150" x2={pos(pct)} y1="18" y2="18" stroke={colour} strokeWidth="3" />
                        <circle cx={pos(pct)} cy="18" r="5" fill={colour} />
                      </>
                    )}
                  </>
                )}
              </svg>
              <span className="flex flex-row justify-between gap-3 text-[11px] text-text-tertiary">
                <span>Actual <b className="block text-xs font-semibold text-text-primary tabular-nums">{poktText(r.y)}</b></span>
                <span className="text-right">Equal share <b className="block text-xs font-semibold text-text-primary tabular-nums">{poktText(r.b)}</b></span>
              </span>
            </span>
            <span className="text-right tabular-nums">
              <strong className="block text-lg font-semibold" style={{ color: pct === null ? undefined : colour }}>{signedPercent(pct)}</strong>
              <small className="block text-[11px] text-text-tertiary">{pct === null ? 'No equal share yet' : 'vs equal share'}</small>
              <span className="inline-block mt-1.5 rounded px-1.5 py-0.5 bg-bg-elevated text-[11px] text-text-secondary whitespace-nowrap">
                Actual ÷ equal share {ratioText(r.y, r.b)}
              </span>
            </span>
          </Row>
        )
      })}
    </div>
  )
}

export function Key({ color, dashed = false, children }: { color: string; dashed?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="6" aria-hidden="true">
        <line x1="1" x2="15" y1="3" y2="3" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {children}
    </span>
  )
}

export type TimePoint = { key: string; label: string; y: string; b: string; note?: string }

/**
 * Actual (solid) and equal share (dashed) per point in POKT, or with `metric="difference"` the difference versus
 * equal share around a 0% line. Hovering or focusing a point shows its values.
 */
export function TimeChart({ points, metric = 'amounts' }: { points: TimePoint[]; metric?: ComparisonMetric }) {
  const [active, setActive] = React.useState<number | null>(null)
  const width = 680, height = 252, left = 62, right = 22, top = 24, bottom = 44
  const values = points.flatMap((p) =>
    metric === 'amounts' ? [toPokt(p.y), toPokt(p.b)] : [differencePercent(p.y, p.b)]).filter((v): v is number => v !== null)
  const low = metric === 'amounts' ? 0 : Math.min(-10, ...values) * 1.15
  const high = Math.max(1, ...values) * 1.15
  const x = (i: number) => left + (points.length > 1 ? i / (points.length - 1) : 0.5) * (width - left - right)
  const y = (v: number) => height - bottom - ((v - low) / (high - low)) * (height - top - bottom)
  const main = (p: TimePoint) => (metric === 'amounts' ? toPokt(p.y) : differencePercent(p.y, p.b))
  const path = (value: (p: TimePoint) => number | null) => {
    let open = false
    return points.map((p, i) => {
      const v = value(p)
      if (v === null) { open = false; return '' }
      const cmd = open ? 'L' : 'M'
      open = true
      return `${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    }).join(' ')
  }
  // Label every point when they fit; otherwise about eight of them.
  const every = Math.max(1, Math.ceil(points.length / 8))
  const axis = (v: number) => (metric === 'amounts' ? countText(v) : signedPercent(v, 0))
  const shown = active === null ? null : points[active]

  return (
    <div className="flex flex-col">
      <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 mt-6 mb-2 text-xs text-text-secondary">
        <Key color="var(--accent)">{metric === 'amounts' ? 'Actual earnings' : 'Earnings difference'}</Key>
        {metric === 'amounts' && <Key color="var(--text-tertiary)" dashed>Equal share</Key>}
        <span className="ml-auto text-[11px] text-text-tertiary min-h-[16px]">
          {shown
            ? <>{shown.label}: actual {poktText(shown.y)}, equal share {poktText(shown.b)}, {signedPercent(differencePercent(shown.y, shown.b))}</>
            : 'Hover or focus a point for its values'}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="group" aria-label={metric === 'amounts' ? 'Actual earnings and equal share' : 'Earnings difference'}>
        {[0, 0.5, 1].map((t) => {
          const v = low + (high - low) * t
          return (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" />
              <text x={left - 9} y={y(v) + 4} textAnchor="end" className="fill-[var(--text-tertiary)] text-[9px]">{axis(v)}</text>
            </g>
          )
        })}
        {metric === 'difference' ? (
          <>
            <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--text-tertiary)" strokeDasharray="3 3" />
            <text x={width - right} y={y(0) - 7} textAnchor="end" className="fill-[var(--text-tertiary)] text-[9px]">Equal share</text>
          </>
        ) : (
          <path d={path((p) => toPokt(p.b))} fill="none" stroke="var(--text-tertiary)" strokeWidth="2.4" strokeDasharray="5 4" />
        )}
        <path d={path(main)} fill="none" stroke="var(--accent)" strokeWidth="2.8" />
        {points.map((p, i) => {
          const v = main(p)
          return (
            <g key={p.key}>
              {v !== null && (
                <g
                  tabIndex={0}
                  role="img"
                  aria-label={`${p.label}: actual ${poktText(p.y)}, equal share ${poktText(p.b)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  <circle cx={x(i)} cy={y(v)} r="16" fill="transparent" />
                  <circle cx={x(i)} cy={y(v)} r={active === i ? 6 : 5} fill="var(--bg-surface)" stroke="var(--accent)" strokeWidth="2.5" />
                </g>
              )}
              {(i % every === 0 || i === points.length - 1) && (
                <text x={x(i)} y={height - bottom + 22} textAnchor="middle" className="fill-[var(--text-secondary)] text-[9.5px]">{p.label}</text>
              )}
            </g>
          )
        })}
        <text x={left} y="13" className="fill-[var(--text-tertiary)] text-[9px]">{metric === 'amounts' ? 'POKT' : 'Difference · %'}</text>
      </svg>
    </div>
  )
}
