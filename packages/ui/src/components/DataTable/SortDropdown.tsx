import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { CheckSmallIcon } from "@igniter/ui/assets";
import { Table } from "@tanstack/react-table";

interface SortDropdownProps<TData> {
  sorts: Array<{
    label: string;
    column: keyof TData;
    direction: "asc" | "desc";
    isDefault?: boolean;
  }>[];
  table: Table<TData>;
  selectedSort?: {
    label: string;
    column: keyof TData;
    direction: "asc" | "desc";
  };
  defaultSort?: {
    label: string;
    column: keyof TData;
    direction: "asc" | "desc";
  };
  currentDirection?: "asc" | "desc";
  disabled?: boolean;
}

export default function SortDropdown<TData>({
  sorts,
  table,
  selectedSort,
  defaultSort,
  currentDirection,
  disabled
}: SortDropdownProps<TData>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled}>
        <div className="flex items-center gap-2 py-2 px-4">
          <span className="text-sm">
            {selectedSort?.label || defaultSort?.label}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        {sorts.map((sortGroup, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {sortGroup.map((sortBy) => (
              <DropdownMenuItem
                key={`${String(sortBy.column)}-${sortBy.label}`}
                className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
                onClick={() =>
                  table
                    .getColumn(String(sortBy.column))
                    ?.toggleSorting(sortBy.direction === "desc")
                }
              >
                <span className="text-sm">{sortBy.label}</span>
                {selectedSort?.label === sortBy.label && <CheckSmallIcon />}
              </DropdownMenuItem>
            ))}
            {groupIndex < sorts.length && <DropdownMenuSeparator />}
          </React.Fragment>
        ))}
        {[
          { label: "Ascending", value: "asc" },
          { label: "Descending", value: "desc" },
        ].map((direction) => (
          <DropdownMenuItem
            key={direction.value}
            className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
            onClick={() => {
              const currentSort = selectedSort;
              if (currentSort) {
                table
                  .getColumn(String(currentSort.column))
                  ?.toggleSorting(currentDirection === "desc" ? false : true);
              }
            }}
          >
            <span className="text-sm">{direction.label}</span>
            {currentDirection === direction.value && <CheckSmallIcon />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
