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
  label: string;
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

export interface DataTableProps<TData extends object, TValue> {
  columns: (ColumnDef<TData, TValue> & CsvColumnDef<TData>)[];
  data: TData[];
  filters: FilterGroup<TData>[];
  sorts: SortOption<TData>[][];
  isLoading?: boolean;
  skeletonRows?: number;
  isError?: boolean
  csvFilename?: string
  refetch?: () => void,
  columnVisibility?: Record<string, boolean>
  /** Column keys to search across with the global search input */
  searchableColumns?: (keyof TData)[]
  searchPlaceholder?: string
}

export default function DataTable<TData extends object, TValue>({
  columns,
  data,
  filters,
  sorts,
  isLoading,
  skeletonRows = 6,
  isError,
  refetch,
  csvFilename,
  columnVisibility,
  searchableColumns,
  searchPlaceholder = 'Search...',
}: DataTableProps<TData, TValue>) {
  const defaultSort = sorts.flat().find((sort) => sort.isDefault);

  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort ? [{
      id: String(defaultSort.column),
      desc: defaultSort.direction === "desc",
    }] : []
  );
  const initialFilters = React.useMemo(() => {
    return filters.flatMap((filterGroup) =>
      filterGroup.items.flat()
        .filter((f) => f.isDefault && f.value !== '')
        .map((f) => ({ id: String(f.column), value: f.value }))
    )
  }, [])

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialFilters
  );
  const [globalFilter, setGlobalFilter] = React.useState('')

  const globalFilterFn = React.useMemo(() => {
    if (!searchableColumns?.length) return undefined
    return (row: any, _columnId: string, filterValue: string) => {
      if (!filterValue) return true
      const q = filterValue.toLowerCase()
      return searchableColumns.some((col) => {
        const val = row.getValue(String(col))
        if (val == null) return false
        if (typeof val === 'object' && 'name' in val) {
          return String(val.name).toLowerCase().includes(q)
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
    autoResetPageIndex: true,
    initialState: {
      pagination: {
        pageSize: 25,
        pageIndex: 0,
      },
      columnVisibility,
    },
    state: {
      columnFilters,
      sorting,
      globalFilter,
    },
  });

  const tableState = table.getState();

  const totalPages = table.getPageCount();
  const currentPage = tableState.pagination.pageIndex;

  const defaultFilters = filters.flatMap((filterGroup) =>
    filterGroup.items.flatMap((filter) => filter.find((f) => f.isDefault) || [])
  );


  const selectedSort = sorts
    .flat()
    .find((sort) => sort.column === sorting[0]?.id);
  const currentDirection = sorting[0]?.desc ? "desc" : "asc";

  let tableBody: React.ReactNode;

  if (isLoading) {
    tableBody = new Array(skeletonRows).fill(null).map((_, index) => (
      <TableRow key={index} className={'pointer-events-none'}>
        {columns.map((_, colIndex) => (
          <TableCell key={`${index}-${colIndex}`}>
            <Skeleton className={'w-4/5 h-4 !bg-[color:#383838]'} />
          </TableCell>
        ))}
      </TableRow>
    ))
  } else if (isError) {
    tableBody = (
      <TableRow className={'hover:bg-[color:var(--color-card)]'}>
        <TableCell colSpan={columns.length} className="h-24 text-center">
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
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))
      ) : (
        <TableRow>
          <TableCell colSpan={columns.length} className="h-24 text-center">
            No results.
          </TableCell>
        </TableRow>
      )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-6">
        {searchableColumns?.length ? (
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            disabled={isLoading || isError}
            className="h-9 w-full sm:max-w-sm md:max-w-md rounded-lg border bg-(--input-bg) px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:--color-blue-1] disabled:opacity-50"
          />
        ) : <div />}
        <div className="flex items-center gap-2 flex-wrap">
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
                          "text-white px-4",
                          align === 'center' && 'text-center',
                          align === 'right' && 'text-right',
                        )
                      }
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
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
            currentPageSize={tableState.pagination.pageSize}
            totalRows={table.getPrePaginationRowModel().rows.length}
            onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
            disabled={isLoading || isError}
          />
          <Pagination
            totalPages={totalPages}
            currentPage={currentPage}
            onPageChange={(pageIndex) => table.setPageIndex(pageIndex)}
            disabled={isLoading || isError}
          />
        </div>
      </div>
    </div>
  );
}
