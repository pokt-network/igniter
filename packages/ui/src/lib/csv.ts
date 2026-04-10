import * as CSV from 'csv-string'

export interface CsvColumnDef<T extends object> {
  accessorKey?: keyof T
  header?: string
  csvHeader?: string
  csvFormatterFn?: (rowData: T) => string
}


export function getFilenameDatetime(useUTC: boolean = false): string {
  const now = new Date();

  const year = useUTC ? now.getUTCFullYear() : now.getFullYear();
  const month = (useUTC ? now.getUTCMonth() : now.getMonth()) + 1;
  const day = useUTC ? now.getUTCDate() : now.getDate();
  const hours = useUTC ? now.getUTCHours() : now.getHours();
  const minutes = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const seconds = useUTC ? now.getUTCSeconds() : now.getSeconds();

  const pad = (n: number) => String(n).padStart(2, '0');

  return `${year}-${pad(month)}-${pad(day)}_${pad(hours)}-${pad(minutes)}-${pad(seconds)}`;
}


export const convertRowToString = <T extends object>(
  columns: Array<CsvColumnDef<T>>,
  row: T,
) => {
  let rowsDataString = ''
  const newObject = (columns).reduce((acc, { csvFormatterFn, accessorKey }) => {
    if (csvFormatterFn && accessorKey) {
      acc[accessorKey] = csvFormatterFn(row)
    }

    return acc
  }, {} as Record<keyof T, string>)

  rowsDataString += CSV.stringify(newObject)
  return rowsDataString
}

export interface ClientExportOptions<T extends object> {
  columns: Array<CsvColumnDef<T>>
  fileNameKey: string
  rows: Array<T> | (() => Array<T>)
  useUtc: boolean
}

export const exportToCsvFromClient = <T extends object>({
  columns,
  fileNameKey,
  rows: rowsProp,
  useUtc
}: ClientExportOptions<T>) => {
  let rowsDataString = ''

  let rows: Array<T>

  if (typeof rowsProp === 'function') {
    rows = rowsProp()
  } else {
    rows = rowsProp
  }

  rows.forEach(
    (item: T) => (rowsDataString += convertRowToString<T>(columns,item))
  )

  const blob = new Blob([CSV.stringify(columns.filter(item => !!item.accessorKey && !!item.csvFormatterFn).map(item => item.csvHeader ?? item.header!)) + rowsDataString], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.setAttribute(
    'download',
    `${fileNameKey}_${getFilenameDatetime(useUtc)}.csv`
  )
  link.click()
}
