import { CSV_BOM, csvContent } from './csv'

type Row = { name: string; amount: string }

const columns = [
  { accessorKey: 'name' as const, csvHeader: 'Name', csvFormatterFn: (r: Row) => r.name },
  { accessorKey: 'amount' as const, csvHeader: 'Actual ÷ equal share', csvFormatterFn: (r: Row) => r.amount },
  // A column without a formatter is not exported.
  { accessorKey: 'amount' as const, header: 'Shown only' },
]

describe('csvContent', () => {
  it('starts with a UTF-8 BOM, then the header and the rows', () => {
    const content = csvContent(columns, [{ name: '6–12 Sep', amount: '0.700609' }, { name: 'a,b', amount: '1' }])
    expect(content.startsWith(CSV_BOM)).toBe(true)
    expect(content.slice(CSV_BOM.length).split(/\r?\n/).filter(Boolean)).toEqual([
      'Name,Actual ÷ equal share',
      '6–12 Sep,0.700609',
      '"a,b",1',
    ])
    expect(Buffer.from(content, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  })

  it('writes the BOM and the header when there are no rows', () => {
    expect(csvContent(columns, []).slice(CSV_BOM.length).trim()).toBe('Name,Actual ÷ equal share')
  })
})
