import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { CheckSmallIcon } from "@igniter/ui/assets";

interface PaginationProps {
  totalRows: number;
  currentPageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  disabled?: boolean;
}

const pageSizeOptions = [25, 50, 75, 100, Number.MAX_SAFE_INTEGER] as const;

export default function RowsPerPage({
  totalRows,
  currentPageSize,
  onPageSizeChange,
  disabled,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-end space-x-2 py-4">
      <DropdownMenu>
        <DropdownMenuTrigger disabled={disabled || totalRows <= pageSizeOptions[0]}>
          <div className="flex items-center gap-2 p-2">
            <span className="text-sm">
              Rows: {currentPageSize === Number.MAX_SAFE_INTEGER ? "All" : currentPageSize}
            </span>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">
          {pageSizeOptions.map((pageSize) => (
            <DropdownMenuItem
              key={pageSize}
              className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
              onClick={() => onPageSizeChange(pageSize)}
            >
              <span className="text-sm">{pageSize === Number.MAX_SAFE_INTEGER ? 'All' : pageSize}</span>
              {currentPageSize === pageSize && <CheckSmallIcon />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
