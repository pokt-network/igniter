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
      label: string;
      value: string | number | boolean;
      column: keyof TData;
      isDefault?: boolean;
    }>[];
  };
  columnFilters: ColumnFiltersState;
  table: Table<TData>;
  defaultLabel: string;
  disabled?: boolean;
}

export default function FilterDropdown<TData>({
  filterGroup,
  columnFilters,
  table,
  defaultLabel,
  disabled
                                              }: FilterDropdownProps<TData>) {
  const isFilterActive = (filterValue: string | number | boolean) => {
    return columnFilters.some((activeFilter) => {
      if (typeof filterValue === "boolean") {
        const activeValue = activeFilter.value === "true" ? true :
          activeFilter.value === "false" ? false :
            activeFilter.value;
        return activeValue === filterValue;
      }
      return activeFilter.value === filterValue;
    });
  };

  const activeFilterLabel = filterGroup.items
    .flat()
    .find((filter) => isFilterActive(filter.value))?.label || defaultLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={disabled}>
        <div className="flex items-center gap-2 py-2 px-4">
          <span className="text-sm">{activeFilterLabel}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        {filterGroup.items.map((group, groupIndex) => (
          <React.Fragment key={groupIndex}>
            {group.map((filter) => (
              <DropdownMenuItem
                key={String(filter.value)}
                className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
                onClick={() => {
                  if (filter.value === "") {
                    table.resetColumnFilters();
                  } else {
                    table.setColumnFilters((_) => [
                      {
                        id: String(filter.column),
                        value: filter.value,
                      },
                    ]);
                  }
                }}
              >
                <span className="text-sm">{filter.label}</span>
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
