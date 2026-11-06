import { decimalString, toBig } from './math'

/*
 * CSV columns of the Analytics tables, in the shape the shared DataTable export reads (accessorKey + csvHeader +
 * csvFormatterFn). Amounts are exact POKT (upokt / 1e6, six decimals) and the header says so.
 */

export type CsvColumn<T> = { accessorKey: keyof T & string; csvHeader: string; csvFormatterFn: (row: T) => string }

/** An upokt amount as an exact POKT decimal string: 201404073796 -> "201404.073796". */
export function upoktToPoktString(upokt: string | null | undefined): string {
  if (upokt === null || upokt === undefined || upokt === '') return ''
  const v = toBig(upokt)
  const sign = v < 0n ? '-' : ''
  const abs = v < 0n ? -v : v
  return `${sign}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0')}`
}

/** Actual ÷ equal share, six decimals rounded half up, exactly; empty when there is no equal share. */
export function ratioString(y: string, b: string): string {
  const eb = toBig(b)
  return eb === 0n ? '' : decimalString(toBig(y), eb, 6)
}

/** Actual against equal share in %, two decimals rounded half up, exactly: -29.94. */
export function vsEqualShareString(y: string, b: string): string {
  const ey = toBig(y)
  const eb = toBig(b)
  return eb === 0n ? '' : decimalString((ey - eb) * 100n, eb, 2)
}

/** The money columns every Analytics group table shares, for rows with `y` and `b` in upokt. */
export function moneyCsvColumns<T extends { y: string; b: string }>(): Array<CsvColumn<T>> {
  return [
    { accessorKey: 'y' as keyof T & string, csvHeader: 'Actual (POKT)', csvFormatterFn: (r) => upoktToPoktString(r.y) },
    { accessorKey: 'b' as keyof T & string, csvHeader: 'Equal share (POKT)', csvFormatterFn: (r) => upoktToPoktString(r.b) },
  ]
}

/** The CSV header line and rows of `columns` over `rows`, as the DataTable export writes them. */
export function csvCells<T>(columns: Array<CsvColumn<T>>, rows: T[]): string[][] {
  return [columns.map((c) => c.csvHeader), ...rows.map((r) => columns.map((c) => c.csvFormatterFn(r)))]
}
