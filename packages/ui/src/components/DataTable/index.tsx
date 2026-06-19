"use client";
import type { CsvColumnDef } from '../../lib/csv'
import React from "react";
import { clsx } from 'clsx'
import {
  ColumnDef,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  ColumnFiltersState,
  SortingState,
  flexRender,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  TableHeader,
} from "@igniter/ui/components/table";
import FilterDropdown from "./FilterDropdown";
import SortDropdown from "./SortDropdown";
import Pagination from "./Pagination";
import { Skeleton } from '../skeleton'
import { Button } from '../button'
import ExportButton from '../ExportButton'
import RowsPerPage from './RowsPerPage'

export interface FilterItem<TData> {
  label: React.ReactNode;
  value: string | number | boolean;
  column: keyof TData;
  isDefault?: boolean;
}

export interface FilterGroup<TData> {
  group: string;
  items: FilterItem<TData>[][];
}

export interface SortOption<TData> {
  label: string;
  column: keyof TData;
  direction: "asc" | "desc";
  isDefault?: boolean;
}

export interface ManualPaginationProps {
  /** Total number of rows across all pages */
  total: number
  pageIndex: number
  pageSize: number
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export interface DataTableProps<TData extends object, TValue> {
  columns: (ColumnDef<TData, TValue> & CsvColumnDef<TData>)[];
  data: TData[];
  filters?: FilterGroup<TData>[];
  sorts?: SortOption<TData>[][];
  isLoading?: boolean;
  skeletonRows?: number;
  isError?: boolean
  csvFilename?: string
  refetch?: () => void,
  columnVisibility?: Record<string, boolean>
  /** Column keys to search across with the global search input */
  searchableColumns?: (keyof TData)[]
  searchPlaceholder?: string
  /** Optional content to render at the left of the toolbar, before filters */
  headerLeft?: React.ReactNode
  /** Label for the auto-generated count chip (e.g. "txs", "keys"). If set, shows a count chip with filtered row count. */
  countLabel?: string
  /** Render a status line showing filtered/total counts */
  renderStatus?: (filteredCount: number, totalCount: number) => React.ReactNode
  /** Toolbar-level actions (e.g. "Add New" button), rendered at the right of the toolbar */
  actions?: React.ReactNode
  /** Per-row action buttons (e.g. edit/delete), rendered as extra cell at the end of each row */
  itemActions?: (row: TData) => React.ReactNode
  /** Disable entire table interaction */
  isDisabled?: boolean
  /** When provided, switches to server-side pagination. The caller owns page state and fetching. */
  manualPagination?: ManualPaginationProps
  /** Optional per-row className callback for highlighting specific rows */
  getRowClassName?: (row: TData) => string
}

export default function DataTable<TData extends object, TValue>({
  columns,
  data,
  filters = [],
  sorts = [],
  isLoading,
  skeletonRows = 6,
  isError,
  refetch,
  csvFilename,
  columnVisibility,
  searchableColumns,
  searchPlaceholder = 'Search...',
  headerLeft,
  countLabel,
  renderStatus,
  actions,
  itemActions,
  isDisabled,
  manualPagination,
  getRowClassName,
}: DataTableProps<TData, TValue>) {
  const isServerPaginated = !!manualPagination
  const defaultSort = sorts.flat().find((sort) => sort.isDefault);

  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort ? [{
      id: String(defaultSort.column),
      desc: defaultSort.direction === "desc",
    }] : []
  );

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    filters.flatMap((filterGroup) =>
      filterGroup.items.flat()
        .filter((f) => f.isDefault && f.value !== '')
        .map((f) => ({ id: String(f.column), value: f.value }))
    )
  );
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [searchInput, setSearchInput] = React.useState('')
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const globalFilterFn = React.useMemo(() => {
    if (!searchableColumns?.length) return undefined
    return (row: any, _columnId: string, filterValue: string) => {
      if (!filterValue) return true
      const q = filterValue.toLowerCase()
      return searchableColumns.some((col) => {
        const val = row.getValue(String(col))
        if (val == null) return false
        if (Array.isArray(val)) {
          return val.some((v) => String(v).toLowerCase().includes(q))
        }
        if (typeof val === 'object' && val !== null) {
          const fields = Object.values(val).filter(v => typeof v === 'string')
          if (fields.some(f => f.toLowerCase().includes(q))) return true
          return false
        }
        if (typeof val === 'object' && 'identity' in val) {
          return String(val.identity).toLowerCase().includes(q) || ('name' in val && String(val.name).toLowerCase().includes(q))
        }
        return String(val).toLowerCase().includes(q)
      })
    }
  }, [searchableColumns])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    autoResetPageIndex: !isServerPaginated,
    ...(isServerPaginated && {
      manualPagination: true,
      pageCount: Math.ceil(manualPagination!.total / manualPagination!.pageSize),
    }),
    initialState: {
      pagination: {
        pageSize: isServerPaginated ? manualPagination!.pageSize : 25,
        pageIndex: isServerPaginated ? manualPagination!.pageIndex : 0,
      },
      columnVisibility,
    },
    state: {
      columnFilters,
      sorting,
      globalFilter,
      ...(isServerPaginated && {
        pagination: {
          pageIndex: manualPagination!.pageIndex,
          pageSize: manualPagination!.pageSize,
        },
      }),
    },
  });

  const tableState = table.getState();

  const totalPages = table.getPageCount();
  const currentPage = tableState.pagination.pageIndex;

  const defaultFilters = filters.flatMap((filterGroup) =>
    filterGroup.items.flatMap((filter) => filter.find((f) => f.value === '') || filter.find((f) => f.isDefault) || [])
  );


  const selectedSort = sorts
    .flat()
    .find((sort) => sort.column === sorting[0]?.id);
  const currentDirection = sorting[0]?.desc ? "desc" : "asc";

  let tableBody: React.ReactNode;

  const totalColSpan = columns.length + (itemActions ? 1 : 0);

  if (isLoading) {
    tableBody = new Array(skeletonRows).fill(null).map((_, index) => (
      <TableRow key={index} className={'pointer-events-none'}>
        {columns.map((_, colIndex) => (
          <TableCell key={`${index}-${colIndex}`}>
            <Skeleton className={'w-4/5 h-4 bg-bg-elevated'} />
          </TableCell>
        ))}
        {itemActions && <TableCell><Skeleton className={'w-4/5 h-4 bg-bg-elevated'} /></TableCell>}
      </TableRow>
    ))
  } else if (isError) {
    tableBody = (
      <TableRow className={'hover:bg-bg-surface'}>
        <TableCell colSpan={totalColSpan} className="h-24 text-center">
          There was an error loading the data.
          {refetch && (
            <Button onClick={refetch} className={'h-[30px] ml-2'}>
              Retry
            </Button>
          )}
        </TableCell>
      </TableRow>
    )
  } else {
    tableBody = table.getRowModel().rows?.length ? (
        table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={row.getIsSelected() && "selected"}
            className={clsx(
              isDisabled ? 'opacity-50 cursor-not-allowed' : '',
              getRowClassName?.(row.original) ?? '',
            )}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
            {itemActions && (
              <TableCell className="flex flex-row-reverse px-2">
                {itemActions(row.original)}
              </TableCell>
            )}
          </TableRow>
        ))
      ) : (
        <TableRow>
          <TableCell colSpan={totalColSpan} className="h-24 text-center">
            No results.
          </TableCell>
        </TableRow>
      )
  }

  return (
    <div>
      {renderStatus && !isLoading && !isError && (
        <div className="pb-2">
          {renderStatus(table.getFilteredRowModel().rows.length, data.length)}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-6">
        <div className="flex items-center gap-3">
          {searchableColumns?.length ? (
            <div className="relative min-w-[280px] sm:min-w-[320px] md:min-w-[380px]">
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchInput}
                onChange={(e) => {
                  const value = e.target.value
                  setSearchInput(value)
                  if (debounceRef.current) clearTimeout(debounceRef.current)
                  debounceRef.current = setTimeout(() => setGlobalFilter(value), 300)
                }}
                disabled={isLoading || isError}
                className="h-9 w-full rounded-lg border bg-(--input-bg) px-3 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:--color-blue-1] disabled:opacity-50"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setGlobalFilter('')
                    if (debounceRef.current) clearTimeout(debounceRef.current)
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              )}
            </div>
          ) : null}
          {countLabel && !isLoading && (
            <span className="inline-flex items-center whitespace-nowrap h-9 px-4 rounded-lg text-sm font-medium bg-bg-elevated text-text-secondary border border-border-primary">
              {table.getFilteredRowModel().rows.length} {countLabel}
            </span>
          )}
          {headerLeft}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions}
          {csvFilename && (
            <ExportButton
              columns={columns}
              rows={() => table.getPrePaginationRowModel().rows.map(r => r.original)}
              useUtc={false}
              disabled={isLoading || isError || data.length === 0}
              fileNameKey={csvFilename}
            />
          )}
          {filters.map((filterGroup, groupIndex) => (
            <FilterDropdown
              key={groupIndex}
              filterGroup={filterGroup}
              columnFilters={columnFilters}
              table={table}
              defaultLabel={defaultFilters[groupIndex]?.label || ""}
              disabled={isLoading || isError}
            />
          ))}
          {
            sorts.length > 0 && (
              <SortDropdown
                sorts={sorts}
                table={table}
                selectedSort={selectedSort}
                defaultSort={defaultSort}
                currentDirection={currentDirection}
                disabled={isLoading || isError}
              />
            )
          }
        </div>
      </div>

      <Table
        containerClassName={
          clsx(
            (sorts.length > 0 || filters.length > 0 || csvFilename) ? 'max-h-[calc(100dvh-310px)]' : 'max-h-[calc(100dvh-270px)]'
          )
        }
      >
        {!isError && (
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className={'bg-transparent'}>
                {headerGroup.headers.map((header) => {
                  // @ts-ignore
                  const align = header.column.columnDef.meta?.headerAlign || 'left'

                  return (
                    <TableHead
                      key={header.id}
                      className={
                        clsx(
                          "text-text-tertiary uppercase text-xs font-semibold tracking-wide px-4",
                          align === 'center' && 'text-center',
                          align === 'right' && 'text-right',
                        )
                      }
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
                {itemActions && <TableHead />}
              </TableRow>
            ))}
          </TableHeader>
        )}
        <TableBody>
          {tableBody}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end space-x-2">
        <div className="flex items-center gap-2">
          <RowsPerPage
            currentPageSize={isServerPaginated ? manualPagination!.pageSize : tableState.pagination.pageSize}
            totalRows={isServerPaginated ? manualPagination!.total : table.getPrePaginationRowModel().rows.length}
            onPageSizeChange={isServerPaginated ? manualPagination!.onPageSizeChange : (pageSize) => table.setPageSize(pageSize)}
            disabled={isLoading || isError}
          />
          <Pagination
            totalPages={isServerPaginated ? Math.ceil(manualPagination!.total / manualPagination!.pageSize) : totalPages}
            currentPage={isServerPaginated ? manualPagination!.pageIndex : currentPage}
            onPageChange={isServerPaginated ? manualPagination!.onPageChange : (pageIndex) => table.setPageIndex(pageIndex)}
            disabled={isLoading || isError}
          />
        </div>
      </div>
    </div>
  );
}
