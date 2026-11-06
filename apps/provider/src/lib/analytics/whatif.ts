/*
 * The "What if your fleet changed?" selection model, ported from @mykyal's fleet analysis (math.js:26-102, the
 * slider range from app.js:267-270) with the same operations in the same order, so its numbers match theirs exactly.
 * A session draws min(cap, total) of the eligible suppliers uniformly without replacement; the other eligible
 * suppliers and the cap stay fixed while your own eligible count changes.
 */

/** One service's model inputs at its reference session. */
export type SelectionReference = {
  /** The suppliers the session drew from (pocketdex `candidates`). */
  totalEligible: number
  /** Yours among them. */
  ownEligible: number
  /** Seats per draw (num_suppliers_per_session). */
  selectionCap: number
}

export type SelectionScenario = {
  ownEligible: number
  otherEligible: number
  totalEligible: number
  selected: number
  minimum: number
  /** The probability of at least `minimum` of yours in a draw. */
  selectionChance: number
  /** The mean number of yours in a draw. */
  expectedPositions: number
}

/** The largest own count the model takes (the slider, the number input and the find-count search). */
export const SCENARIO_MAX_SUPPLIERS = 100_000

const logFactorials = [0]
function logFactorial(n: number): number {
  for (let i = logFactorials.length; i <= n; i++) logFactorials[i] = logFactorials[i - 1]! + Math.log(i)
  return logFactorials[n]!
}
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/** P(X = x) for x = 0..selected: how many of `own` among `total` a draw of `selected` takes (hypergeometric). */
export function selectionDistribution(total: number, own: number, selected: number): number[] {
  if (![total, own, selected].every(Number.isInteger) || total < 0 || own < 0 || own > total || selected < 0 || selected > total) {
    throw new RangeError('Require integer counts with 0 ≤ own ≤ total and 0 ≤ selected ≤ total.')
  }
  if (total === 0) return [1]
  const probabilities: number[] = Array(selected + 1).fill(0)
  const lower = Math.max(0, selected - (total - own))
  const upper = Math.min(own, selected)
  const denominator = logChoose(total, selected)
  for (let x = lower; x <= upper; x++) probabilities[x] = Math.exp(logChoose(own, x) + logChoose(total - own, selected - x) - denominator)
  const sum = probabilities.reduce((a, b) => a + b, 0)
  return probabilities.map((p) => p / sum)
}

/** P(at least `minimum` of yours in a draw), with `other` other eligible suppliers and `cap` seats. */
export function selectionTail(other: number, own: number, cap: number, minimum = 1): number {
  if (![other, own, cap, minimum].every(Number.isInteger) || other < 0 || own < 0 || cap < 1 || minimum < 1) {
    throw new RangeError('Use nonnegative integer Supplier counts and positive integer cap and threshold.')
  }
  const total = other + own
  const selected = Math.min(cap, total)
  if (own < minimum || selected < minimum) return 0
  if (Math.max(0, selected - other) >= minimum) return 1
  // A short complement product is stable even for very large scenario counts.
  let zero = 1
  if (other >= selected) {
    for (let i = 0; i < selected; i++) zero *= (other - i) / (total - i)
  } else zero = 0
  // Only the support check above gives certainty: a rounded complement never turns a high finite chance into 100%.
  if (minimum === 1) return Math.max(0, Math.min(1 - Number.EPSILON, 1 - zero))
  const distribution = selectionDistribution(total, own, selected)
  return Math.max(0, Math.min(1 - Number.EPSILON, distribution.slice(minimum).reduce((a, b) => a + b, 0)))
}

/** An own count as the model takes it: rounded, and clamped to 0..SCENARIO_MAX_SUPPLIERS. */
export const clampScenarioCount = (own: number) => Math.max(0, Math.min(SCENARIO_MAX_SUPPLIERS, Math.round(Number(own) || 0)))

/** The model at `own` eligible suppliers of yours (see clampScenarioCount). */
export function exposureScenario(reference: SelectionReference, own: number, minimum = 1): SelectionScenario {
  const count = clampScenarioCount(own)
  const other = reference.totalEligible - reference.ownEligible
  const total = other + count
  const selected = Math.min(reference.selectionCap, total)
  return {
    ownEligible: count,
    otherEligible: other,
    totalEligible: total,
    selected,
    minimum,
    selectionChance: selectionTail(other, count, reference.selectionCap, minimum),
    expectedPositions: total ? selected * count / total : 0,
  }
}

/** The smallest own count whose chance of at least `minimum` reaches `target` (0 < target ≤ 1); null if none does. */
export function countForTarget(reference: SelectionReference, target: number, minimum = 1): number | null {
  if (!Number.isFinite(target) || target <= 0 || target > 1 || !Number.isInteger(minimum) || minimum < 1) {
    throw new RangeError('Use a target greater than 0 and at most 1, and a positive integer selection minimum.')
  }
  if (minimum > reference.selectionCap) return null
  const other = reference.totalEligible - reference.ownEligible
  if (target === 1) return other + minimum <= reference.selectionCap ? minimum : null
  let high = Math.max(1, reference.ownEligible)
  while (selectionTail(other, high, reference.selectionCap, minimum) < target && high < SCENARIO_MAX_SUPPLIERS) high *= 2
  high = Math.min(SCENARIO_MAX_SUPPLIERS, high)
  if (selectionTail(other, high, reference.selectionCap, minimum) < target) return null
  let low = 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (selectionTail(other, mid, reference.selectionCap, minimum) >= target) high = mid
    else low = mid + 1
  }
  return low
}

/** The slider's top: the count for 99%, twice the recorded count, or the scenario, whichever is largest, up to the next 25. */
export function scenarioMaximum(reference: SelectionReference, minimum: number, scenarioCount: number | null): number {
  const target = countForTarget(reference, 0.99, minimum) ?? Math.max(reference.ownEligible * 3, 200)
  return roundedMaximum(Math.max(target, reference.ownEligible * 2), scenarioCount)
}

/** The top for a scenario count over a top already found without one: no second search, the same rounding. */
export function scenarioMaximumWith(recordedMaximum: number, scenarioCount: number | null): number {
  return roundedMaximum(recordedMaximum, scenarioCount)
}

function roundedMaximum(base: number, scenarioCount: number | null): number {
  return Math.min(SCENARIO_MAX_SUPPLIERS, Math.max(100, Math.ceil(Math.max(base, scenarioCount ?? 0) / 25) * 25))
}

/** A number with exactly `decimals` decimals and thousands separators, as the card shows counts and means. */
export const scenarioNumber = (value: number, decimals = 0) =>
  value.toLocaleString('en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })

/** The chance as the card shows it: ">99.9%" for a finite chance that would round to 100% (app.js:32). */
export function chanceLabel(fraction: number): string {
  return fraction < 1 && fraction >= 0.9995 ? '>99.9%' : `${scenarioNumber(fraction * 100, 1)}%`
}

/** A target as the card shows it: up to 6 decimals, no trailing zeros (app.js:33). */
export function targetLabel(fraction: number): string {
  return `${Number((fraction * 100).toFixed(6)).toLocaleString('en-GB', { maximumFractionDigits: 6 })}%`
}
