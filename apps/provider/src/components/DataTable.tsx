"use client"

import type {
  ColumnDef,
} from '@igniter/ui/components/table';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getFilteredRowModel,
} from "@igniter/ui/components/table"
import { Input } from "@igniter/ui/components/input"
import { ReactNode, useState } from "react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  actions?: ReactNode;
  itemActions?: (row: TData) => ReactNode;
  data: TData[];
  isDisabled?: boolean;
  searchableFields?: string[];
}

export function DataTable<TData, TValue>({
                                           columns,
                                           data,
                                           actions,
                                           itemActions,
                                           isDisabled = false,
                                           searchableFields = [], // Default to empty array if not provided
                                         }: DataTableProps<TData, TValue>) {
  const [searchTerm, setSearchTerm] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      globalFilter: searchTerm,
    },
    onGlobalFilterChange: setSearchTerm,
    globalFilterFn: (row, columnId, filterValue) => {
      if (searchableFields.length === 0) {
        const value = String(row.getValue(columnId) || "").toLowerCase();
        return value.includes(filterValue.toLowerCase());
      }

      return searchableFields.some(field => {
        const value = String(row.getValue(field) || "").toLowerCase();
        return value.includes(filterValue.toLowerCase());
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {searchableFields.length > 0 && (
          <Input
            placeholder={`Search by ${searchableFields.join(", ")}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
        )}
        {searchableFields.length === 0 && (<span></span>)}
        <div>
          {actions}
        </div>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="hover:bg-transparent"
            >
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                  </TableHead>
                )
              })}
              {itemActions && (
                <TableHead />
              )}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className={`bg-transparent r group ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
                {actions && <TableCell />}
                {itemActions && (
                  <TableCell className="flex flex-row-reverse px-2">
                    {itemActions(row.original)}
                  </TableCell>
                )}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={actions && itemActions
                  ? columns.length + 2
                  : actions || itemActions
                    ? columns.length + 1
                    : columns.length}
                className="h-24 text-center"
              >
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
