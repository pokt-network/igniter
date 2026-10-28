import { chanceLabel, clampScenarioCount, countForTarget, exposureScenario, scenarioMaximum, scenarioMaximumWith, selectionTail, targetLabel, type SelectionReference } from './whatif'

// Every expected value comes from @mykyal's own math.js run on the same inputs (the reference of Base on 5 Oct 2026:
// 2,342 yours of 3,352 eligible, 50 seats), so these tests hold the port to their exact numbers.
const ref: SelectionReference = { totalEligible: 3352, ownEligible: 2342, selectionCap: 50 }

describe('the selection model, against @mykyal\'s outputs', () => {
  it('gives the recorded count\'s chance and expected count', () => {
    const s = exposureScenario(ref, 2342, 1)
    expect(s.selectionChance).toBe(0.9999999999999998)
    expect(s.expectedPositions).toBeCloseTo(34.9344, 4)
    expect(chanceLabel(s.selectionChance)).toBe('>99.9%')
    expect(s).toMatchObject({ ownEligible: 2342, otherEligible: 1010, totalEligible: 3352, selected: 50 })
  })

  it.each([
    [1, 0.9999999999999998, [47, 61, 96]],
    [10, 0.9999999999999702, [370, 415, 514]],
    [30, 0.9514012665453967, [2096, 2333, 2862]],
    [35, 0.5613602658467667, [3327, 3741, 4695]],
    [40, 0.07446945637465452, [5947, 6832, 8972]],
  ])('at least %i of yours: chance and the counts for 90 / 95 / 99%%', (k, chance, counts) => {
    expect(exposureScenario(ref, 2342, k).selectionChance).toBe(chance)
    expect([0.9, 0.95, 0.99].map((t) => countForTarget(ref, t, k))).toEqual(counts)
  })

  it('cannot reach a target for all 50 seats, nor a minimum above the cap', () => {
    expect(exposureScenario(ref, 2342, 50).selectionChance).toBeCloseTo(1.395941254900724e-8, 20)
    expect(countForTarget(ref, 0.9, 50)).toBeNull()
    expect(countForTarget(ref, 0.9, 51)).toBeNull()
  })

  it('handles none, one, and certainty only from the support', () => {
    expect(exposureScenario(ref, 0, 1).selectionChance).toBe(0)
    expect(exposureScenario(ref, 1, 1).selectionChance).toBe(0.04945598417408492)
    expect(selectionTail(30, 25, 50, 20)).toBe(1)
    expect(selectionTail(10, 45, 50, 5)).toBe(1)
    expect(countForTarget({ totalEligible: 40, ownEligible: 10, selectionCap: 50 }, 1, 1)).toBe(1)
  })

  it('sets the slider top as the site does, and labels targets', () => {
    expect(scenarioMaximum(ref, 1, null)).toBe(4700)
    expect(scenarioMaximum(ref, 35, null)).toBe(4700)
    expect(scenarioMaximum(ref, 40, null)).toBe(8975)
    // A scenario past the top raises it, rounded up to 25, the same with or without the second search.
    for (const count of [10, 4700, 4701, 12345, 200000]) expect(scenarioMaximumWith(scenarioMaximum(ref, 1, null), count)).toBe(scenarioMaximum(ref, 1, count))
    expect(clampScenarioCount(-3)).toBe(0)
    expect(clampScenarioCount(2342.6)).toBe(2343)
    expect(clampScenarioCount(1e9)).toBe(100000)
    expect(targetLabel(0.95)).toBe('95%')
    expect(targetLabel(0.9975)).toBe('99.75%')
    expect(chanceLabel(0.9514012665453967)).toBe('95.1%')
  })

  it('rejects counts and targets outside the model', () => {
    expect(() => countForTarget(ref, 0, 1)).toThrow(RangeError)
    expect(() => countForTarget(ref, 1.01, 1)).toThrow(RangeError)
    expect(() => selectionTail(-1, 1, 50, 1)).toThrow(RangeError)
  })
})
