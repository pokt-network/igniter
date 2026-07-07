import { parseDuration } from '@/duration'

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['30s', 30_000],
    ['3m', 180_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ])('parses %s -> %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected)
  })

  it.each(['', 'abc', '10', '10x', 'm', '1.5s', '-5s', '10 s', null as unknown as string])(
    'returns null (never throws) for invalid %p',
    (input) => {
      expect(parseDuration(input)).toBeNull()
    },
  )

  it('trims surrounding whitespace', () => {
    expect(parseDuration('  45s  ')).toBe(45_000)
  })
})
