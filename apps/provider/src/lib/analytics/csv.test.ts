import { convertRowToString } from '@igniter/ui/lib/csv'
import { csvCells, moneyCsvColumns, ratioString, upoktToPoktString, vsEqualShareString, type CsvColumn } from './csv'

type Row = { serviceId: string; y: string; b: string; sessions: number }

const columns: Array<CsvColumn<Row & { ratio: string; vs: string }>> = [
  { accessorKey: 'serviceId', csvHeader: 'Service', csvFormatterFn: (r) => r.serviceId },
  ...moneyCsvColumns<Row & { ratio: string; vs: string }>(),
  { accessorKey: 'ratio', csvHeader: 'Actual ÷ equal share', csvFormatterFn: (r) => ratioString(r.y, r.b) },
  { accessorKey: 'vs', csvHeader: 'vs equal share (%)', csvFormatterFn: (r) => vsEqualShareString(r.y, r.b) },
  { accessorKey: 'sessions', csvHeader: 'Sessions', csvFormatterFn: (r) => String(r.sessions) },
]

const rows = [
  { serviceId: 'bsc', y: '201404073796', b: '287469909057', sessions: 5314, ratio: '', vs: '' },
  { serviceId: 'eth', y: '7', b: '0', sessions: 1, ratio: '', vs: '' },
]

describe('analytics CSV', () => {
  it('amounts are exact POKT with six decimals', () => {
    expect(upoktToPoktString('201404073796')).toBe('201404.073796')
    expect(upoktToPoktString('5')).toBe('0.000005')
    expect(upoktToPoktString('-1500000')).toBe('-1.500000')
    expect(upoktToPoktString(null)).toBe('')
  })

  it('builds the header and the rows with real values, no undefined', () => {
    expect(csvCells(columns, rows)).toEqual([
      ['Service', 'Actual (POKT)', 'Equal share (POKT)', 'Actual ÷ equal share', 'vs equal share (%)', 'Sessions'],
      ['bsc', '201404.073796', '287469.909057', '0.700609', '-29.94', '5314'],
      ['eth', '0.000007', '0.000000', '', '', '1'],
    ])
  })

  it('the ratio and the % are rounded half up, exactly', () => {
    // 1/8 = 0.125 and 9/8 = 1.125: their 7th and 3rd decimals are an exact 5.
    expect(ratioString('1', '8000000')).toBe('0.000000') // 0.000000125
    expect(ratioString('1', '2000000')).toBe('0.000001') // 0.0000005
    expect(vsEqualShareString('9', '8')).toBe('12.50')
    expect(vsEqualShareString('10001', '80000')).toBe('-87.50') // -87.49875
    expect(vsEqualShareString('100125', '100000')).toBe('0.13') // 0.125
    expect(vsEqualShareString('99875', '100000')).toBe('-0.13') // -0.125
  })

  it('the shared DataTable export writes every column of a row', () => {
    const line = convertRowToString(columns, rows[0]!)
    expect(line).not.toContain('undefined')
    expect(line.trim()).toBe('bsc,201404.073796,287469.909057,0.700609,-29.94,5314')
  })
})
