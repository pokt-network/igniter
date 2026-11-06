'use client'

import React from 'react'
import { RotateCcw } from 'lucide-react'
import { BaseQuickInfoTooltip } from '@igniter/ui/components/BaseQuickInfoTooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@igniter/ui/components/select'
import type { AnalyticsSelectionReferenceRow } from '@/lib/dal/analytics'
import {
  chanceLabel,
  clampScenarioCount,
  countForTarget,
  exposureScenario,
  scenarioMaximum,
  scenarioMaximumWith,
  scenarioNumber,
  targetLabel,
  SCENARIO_MAX_SUPPLIERS,
  type SelectionReference,
  type SelectionScenario,
} from '@/lib/analytics/whatif'
import { formatDay } from './format'
import { Card } from './ui'

/*
 * "What if your fleet changed?": the selection model of @mykyal's fleet analysis (its scenario card, app.js:272-322,
 * 484-500 and 652) over the period's reference of each service. Only the selection chance changes; the earnings above
 * stay historical. The state lives here: a new period or service filter remounts the card at the recorded count.
 */

const MINIMUM_PRESETS = [1, 2, 3, 5]
const TARGET_PRESETS = [0.9, 0.95, 0.99]

const asModel = (r: AnalyticsSelectionReferenceRow): SelectionReference => ({
  totalEligible: r.candidates,
  ownEligible: r.ownEligible,
  selectionCap: r.cap,
})

export default function WhatIfCard({ references }: { references: AnalyticsSelectionReferenceRow[] }) {
  const [serviceId, setServiceId] = React.useState(references[0]?.serviceId ?? '')
  const [minimum, setMinimum] = React.useState(1)
  const [customMinimum, setCustomMinimum] = React.useState(false)
  const [count, setCount] = React.useState<number | null>(null)
  const [target, setTarget] = React.useState<number | null>(null)
  const [targetInput, setTargetInput] = React.useState('95')
  const [targetError, setTargetError] = React.useState<string | null>(null)

  const row = references.find((r) => r.serviceId === serviceId) ?? references[0]
  const reference = React.useMemo(() => (row ? asModel(row) : null), [row])
  // The searches and the curve depend on the reference and the minimum, not on the slider: kept across its ticks.
  const recordedMaximum = React.useMemo(() => (reference ? scenarioMaximum(reference, minimum, null) : 0), [reference, minimum])
  const targetCount = React.useMemo(
    () => (reference && target !== null ? countForTarget(reference, target, minimum) : null),
    [reference, target, minimum],
  )
  if (!row || !reference) {
    return (
      <Card>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">What if your fleet changed?</h2>
        <p className="mt-1.5 text-sm text-text-secondary">
          The selection model needs a final day of the period with a session of yours. It appears once a day closes.
        </p>
      </Card>
    )
  }
  const own = count ?? reference.ownEligible
  const scenario = exposureScenario(reference, own, minimum)
  const base = exposureScenario(reference, reference.ownEligible, minimum)
  const maximum = scenarioMaximumWith(recordedMaximum, count)

  const reset = () => {
    setCount(null)
    setTarget(null)
    setTargetError(null)
  }
  const chooseService = (id: string) => {
    setServiceId(id)
    reset()
  }
  const chooseMinimum = (value: string) => {
    if (value === 'custom') {
      setCustomMinimum(true)
      return
    }
    setCustomMinimum(false)
    setMinimum(Number(value))
    setTarget(null)
  }
  const applyTarget = (t: number) => {
    if (!Number.isFinite(t) || t <= 0 || t > 1) {
      setTargetError('Enter a target greater than 0% and no higher than 100%.')
      return
    }
    setTargetError(null)
    setTarget(t)
    setTargetInput(String(Number((t * 100).toFixed(6))))
    const found = countForTarget(reference, t, minimum)
    if (found !== null) setCount(found)
  }

  const message = targetError
    ?? (target === null
      ? `Targets refer to selecting at least ${minimum} of your suppliers in a session.`
      : targetCount === null
        ? `A ${targetLabel(target)} chance of at least ${minimum} selected cannot be reached within the model’s cap and ${scenarioNumber(SCENARIO_MAX_SUPPLIERS)}-supplier limit.`
        : `${scenarioNumber(targetCount)} eligible suppliers are the smallest fleet that reaches a ${targetLabel(target)} chance of at least ${minimum} selected.`)

  return (
    <Card>
      <div className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">What if your fleet changed?</h2>
          <p className="mt-1.5 text-sm text-text-secondary">
            Change your eligible supplier count and see the chance of being selected. Reference: {formatDay(row.day)}.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-bg-hover"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      {references.length > 1 && (
        <div className="mt-5 flex flex-row flex-wrap items-center gap-3 text-xs text-text-secondary">
          <label className="flex flex-row items-center gap-3">
            Selection model for
            <Select value={row.serviceId} onValueChange={chooseService}>
              <SelectTrigger className="min-w-44 w-fit gap-2" aria-label="Selection model for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {references.map((r) => <SelectItem key={r.serviceId} value={r.serviceId}>{r.serviceId}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <span className="text-text-tertiary">Selection is calculated separately for each service.</span>
        </div>
      )}

      <div className="mt-4 flex flex-row flex-wrap items-center gap-3 text-sm text-text-secondary">
        <span>What chance do you want to explore?</span>
        <label className="flex flex-row items-center gap-2">
          Select at least
          <Select value={customMinimum || !MINIMUM_PRESETS.includes(minimum) ? 'custom' : String(minimum)} onValueChange={chooseMinimum}>
            <SelectTrigger className="min-w-36 w-fit gap-2" aria-label="Select at least">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINIMUM_PRESETS.map((m) => <SelectItem key={m} value={String(m)}>{m} of yours</SelectItem>)}
              <SelectItem value="custom">Custom count</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {(customMinimum || !MINIMUM_PRESETS.includes(minimum)) && (
          <label className="flex flex-row items-center gap-2">
            Selected suppliers
            <input
              type="number"
              min={1}
              max={SCENARIO_MAX_SUPPLIERS}
              step={1}
              value={minimum}
              onChange={(e) => {
                setMinimum(Math.max(1, Math.min(SCENARIO_MAX_SUPPLIERS, Math.round(Number(e.target.value) || 1))))
                setTarget(null)
              }}
              className="w-24 rounded-md border border-border-primary bg-bg-surface px-2 py-1 text-sm tabular-nums text-text-primary"
            />
          </label>
        )}
      </div>
      {minimum > reference.selectionCap && (
        <p role="status" className="mt-2 text-xs text-warning">
          This service selects up to {reference.selectionCap} suppliers per session. Selecting at least {minimum} is impossible under that cap.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-row items-center justify-between gap-3">
              <label htmlFor="whatif-count" className="text-sm font-medium text-text-primary">Your eligible suppliers</label>
              <input
                type="number"
                aria-label="Exact eligible supplier count"
                min={0}
                max={SCENARIO_MAX_SUPPLIERS}
                step={1}
                value={own}
                onChange={(e) => setCount(clampScenarioCount(Number(e.target.value)))}
                className="w-28 rounded-md border border-border-primary bg-bg-surface px-2 py-1 text-right text-sm tabular-nums text-text-primary"
              />
            </div>
            <input
              id="whatif-count"
              type="range"
              min={0}
              max={maximum}
              step={1}
              value={own}
              aria-valuetext={`${own} eligible suppliers`}
              onChange={(e) => setCount(clampScenarioCount(Number(e.target.value)))}
              className="w-full accent-[var(--accent)]"
            />
            <div className="flex flex-row justify-between text-[11px] text-text-tertiary tabular-nums">
              <span>0</span>
              <span>{scenarioNumber(maximum)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4" aria-live="polite">
            <Metric
              value={chanceLabel(scenario.selectionChance)}
              label={<>chance of selecting <b className="text-text-primary">at least {minimum} of yours</b> per session</>}
              note={chanceNote(scenario, base)}
            />
            <Metric value={scenarioNumber(scenario.expectedPositions, 2)} label="expected selected per session" note={expectedNote(scenario, base)} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-row flex-wrap items-center gap-2 text-sm text-text-secondary">
              <span>Find a fleet size for</span>
              {TARGET_PRESETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={target === t}
                  onClick={() => applyTarget(t)}
                  className={`rounded-md border px-3 py-1 text-xs font-semibold tabular-nums ${target === t ? 'border-accent bg-accent/10 text-accent' : 'border-border-primary bg-bg-surface text-text-primary hover:bg-bg-hover'}`}
                >
                  {targetLabel(t)}
                </button>
              ))}
            </div>
            <form
              className="flex flex-row flex-wrap items-center gap-2 text-sm text-text-secondary"
              onSubmit={(e) => {
                e.preventDefault()
                applyTarget(Number(targetInput) / 100)
              }}
            >
              <label htmlFor="whatif-target">Custom target</label>
              <span className="inline-flex items-center gap-1">
                <input
                  id="whatif-target"
                  type="number"
                  min={0.000001}
                  max={100}
                  step="any"
                  value={targetInput}
                  aria-label="Custom selection chance, percent"
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="w-24 rounded-md border border-border-primary bg-bg-surface px-2 py-1 text-right text-sm tabular-nums text-text-primary"
                />
                <span aria-hidden="true">%</span>
              </span>
              <button type="submit" className="rounded-md border border-border-primary bg-bg-surface px-3 py-1 text-xs font-semibold text-text-primary hover:bg-bg-hover">
                Find count
              </button>
            </form>
            <p role="status" className={`text-xs ${targetError ? 'text-warning' : 'text-text-tertiary'}`}>{message}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <ScenarioChart reference={reference} scenario={scenario} minimum={minimum} maximum={maximum} target={target ?? 0.95} />
          <div className="flex flex-row flex-wrap gap-4 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1.5"><Dot color="var(--warning)" /> Recorded count</span>
            <span className="inline-flex items-center gap-1.5"><Dot color="var(--accent)" /> Your scenario</span>
          </div>
          <p className="text-xs text-text-tertiary tabular-nums">
            {scenarioNumber(scenario.ownEligible)} yours + {scenarioNumber(scenario.otherEligible)} other suppliers = {scenarioNumber(scenario.totalEligible)} eligible. {scenarioNumber(scenario.selected)} selected per draw.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-row flex-wrap items-center justify-between gap-3 border-t border-border-primary pt-4 text-xs text-text-tertiary">
        <span>Other eligible suppliers stay fixed. Earnings above remain historical.</span>
        <BaseQuickInfoTooltip title="What changes in this scenario?" description={<Assumptions row={row} />}>
          <button type="button" className="font-semibold text-accent hover:underline">Model assumptions</button>
        </BaseQuickInfoTooltip>
      </div>
    </Card>
  )
}

function chanceNote(scenario: SelectionScenario, base: SelectionScenario): string {
  if (scenario.ownEligible === base.ownEligible) return 'At the recorded count'
  const change = (scenario.selectionChance - base.selectionChance) * 100
  if (Math.abs(change) < 0.05) return 'Similar selection chance'
  return `${change > 0 ? '+' : '−'}${scenarioNumber(Math.abs(change), 1)} percentage points`
}

function expectedNote(scenario: SelectionScenario, base: SelectionScenario): string {
  if (scenario.ownEligible === base.ownEligible) return 'At the recorded count'
  const change = scenario.expectedPositions - base.expectedPositions
  if (Math.abs(change) < 0.005) return 'Similar position count'
  return `${change > 0 ? '+' : '−'}${scenarioNumber(Math.abs(change), 2)} vs recorded count`
}

function Metric({ value, label, note }: { value: string; label: React.ReactNode; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-primary bg-bg-elevated p-4">
      <strong className="text-[28px] leading-tight font-semibold tracking-tight tabular-nums text-text-primary">{value}</strong>
      <span className="text-xs text-text-secondary">{label}</span>
      <small className="text-[11px] text-text-tertiary">{note}</small>
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={color} /></svg>
}

function Assumptions({ row }: { row: AnalyticsSelectionReferenceRow }) {
  return (
    <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto p-[12px_16px] text-[13px] text-text-tertiary">
      <p>
        The tool changes your eligible supplier count while holding the other {scenarioNumber(row.candidates - row.ownEligible)} eligible
        suppliers and the {row.cap}-seat cap fixed. Your count and the total eligible population both change.
      </p>
      <p>Every added supplier is assumed eligible for this service. A session selects the smaller of the cap and the total eligible population, uniformly without replacement.</p>
      <p><strong>Selection chance</strong> is the probability of reaching the chosen minimum. <strong>Expected selected</strong> is the average number of your suppliers in the seats of a draw.</p>
      <p>When almost every session already has one of yours, more suppliers can still add seats. Presence alone does not describe the whole opportunity.</p>
      <p>
        The reference is the latest session of {formatDay(row.day)} for this service (block {scenarioNumber(row.height)}): its {scenarioNumber(row.candidates)} eligible
        suppliers, and {scenarioNumber(row.ownEligible)} of yours among them. The earnings above stay those of the selected period.
      </p>
      <p>With N all eligible suppliers, n yours and K seats, the number of yours in a draw is Hypergeometric(N, n, K): P(X ≥ 1) = 1 − C(N − n, K) / C(N, K), and the expected selected is K × n / N, with K = min(cap, N).</p>
    </div>
  )
}

/** The chance against your eligible count, 0 to `maximum`: a target line, the recorded count and the scenario. */
function ScenarioChart({ reference, scenario, minimum, maximum, target }: {
  reference: SelectionReference
  scenario: SelectionScenario
  minimum: number
  maximum: number
  target: number
}) {
  const width = 540, height = 238, left = 42, right = 12, top = 15, bottom = 38
  const x = (v: number) => left + (v / maximum) * (width - left - right)
  const y = (v: number) => top + (1 - v) * (height - top - bottom)
  // The curve changes with the reference, the minimum and the axis only, never with the scenario point.
  const { path, area, recorded } = React.useMemo(() => {
    const points = Array.from({ length: 85 }, (_, i) => {
      const n = Math.round((i / 84) * maximum)
      return [n, exposureScenario(reference, n, minimum).selectionChance] as const
    })
    const line = points.map(([n, c], i) => `${i ? 'L' : 'M'}${x(n).toFixed(2)},${y(c).toFixed(2)}`).join(' ')
    return {
      path: line,
      area: `${line} L${x(maximum)},${y(0)} L${x(0)},${y(0)} Z`,
      recorded: exposureScenario(reference, reference.ownEligible, minimum),
    }
    // x and y are pure functions of `maximum` and the fixed chart box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, minimum, maximum])
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Chance of selecting at least ${minimum} of your suppliers per session, by eligible count. Recorded ${reference.ownEligible}: ${chanceLabel(recorded.selectionChance)}. Scenario ${scenario.ownEligible}: ${chanceLabel(scenario.selectionChance)}.`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke="var(--border-subtle)" />
          <text x={left - 9} y={y(v) + 3} textAnchor="end" className="fill-[var(--text-tertiary)] text-[9px]">{`${v * 100}%`}</text>
        </g>
      ))}
      <path d={area} fill="var(--accent)" fillOpacity={0.08} />
      <line x1={left} x2={width - right} y1={y(target)} y2={y(target)} stroke="var(--text-tertiary)" strokeDasharray="3 3" />
      <text x={width - right} y={Math.max(top + 10, y(target) - 7)} textAnchor="end" className="fill-[var(--text-tertiary)] text-[9px]">{`${targetLabel(target)} target`}</text>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} x={x(maximum * v)} y={height - bottom + 18} textAnchor="middle" className="fill-[var(--text-tertiary)] text-[9px]">
          {scenarioNumber(Math.round(maximum * v))}
        </text>
      ))}
      <text x={width / 2} y={height - 3} textAnchor="middle" className="fill-[var(--text-tertiary)] text-[9px]">Your eligible supplier count</text>
      <circle cx={x(reference.ownEligible)} cy={y(recorded.selectionChance)} r="4.5" fill="var(--warning)" stroke="var(--bg-surface)" strokeWidth="1.5">
        {/* One text child: React renders <title> as a single string, and several would not hydrate. */}
        <title>{`Recorded count: ${scenarioNumber(reference.ownEligible)}, ${chanceLabel(recorded.selectionChance)}`}</title>
      </circle>
      <circle cx={x(Math.min(scenario.ownEligible, maximum))} cy={y(scenario.selectionChance)} r="5.5" fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="1.5">
        <title>{`Your scenario: ${scenarioNumber(scenario.ownEligible)}, ${chanceLabel(scenario.selectionChance)}`}</title>
      </circle>
    </svg>
  )
}
