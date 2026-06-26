import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { CheckSmallIcon } from "@igniter/ui/assets";
import { ColumnFiltersState, Table } from "@tanstack/react-table";

interface FilterDropdownProps<TData> {
  filterGroup: {
    group: string;
    items: Array<{
      label: React.ReactNode;
      value: string | number | boolean;
      column: keyof TData;
      isDefault?: boolean;
    }>[];
  };
  columnFilters: ColumnFiltersState;
  table: Table<TData>;
  defaultLabel: React.ReactNode;
  disabled?: boolean;
}

export default function FilterDropdown<TData>({
  filterGroup,
  columnFilters,
  table,
  defaultLabel,
  disabled
                                              }: FilterDropdownProps<TData>) {
  const columnId = String(filterGroup.items.flat()[0]?.column ?? '');

  const isFilterActive = (filterValue: string | number | boolean) => {
    return columnFilters.some((activeFilter) => {
      if (activeFilter.id !== columnId) return false;
      if (typeof filterValue === "boolean") {
        const activeValue = activeFilter.value === "true" ? true :
          activeFilter.value === "false" ? false :
            activeFilter.value;
        return activeValue === filterValue;
      }
      return activeFilter.value === filterValue;
    });
  };

  const activeFilter = columnFilters.find((f) => f.id === columnId);
  const activeFilterLabel = activeFilter
    ? filterGroup.items.flat().find((filter) => filter.value === activeFilter.value)?.label || defaultLabel
    : defaultLabel;

  return (
    <DropdownMenu>
      {/* Deterministic ids (derived from the column) keep SSR and client markup identical.
          The number of FilterDropdowns is data-dependent (empty on SSR, populated on the
          client), so relying on radix's positional useId() counter caused hydration id
          mismatches. A stable id removes these dropdowns from that counter. */}
      <DropdownMenuTrigger id={`filter-trigger-${columnId}`} disabled={disabled}>
        <div className="flex items-center gap-2 py-2 px-4">
          <span className="text-sm flex items-center gap-2">{activeFilterLabel}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent id={`filter-content-${columnId}`} side="top">
        {filterGroup.items.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {group.map((filter) => (
              <DropdownMenuItem
                key={String(filter.value)}
                className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
                onClick={() => {
                  table.setColumnFilters((prev) => {
                    const without = prev.filter((f) => f.id !== columnId);
                    if (filter.value === "") return without;
                    return [...without, { id: columnId, value: filter.value }];
                  });
                }}
              >
                <span className="text-sm flex items-center gap-2">{filter.label}</span>
                {isFilterActive(filter.value) && <CheckSmallIcon />}
              </DropdownMenuItem>
            ))}
            {groupIndex < filterGroup.items.length - 1 && (
              <DropdownMenuSeparator />
            )}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
