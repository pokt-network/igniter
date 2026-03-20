import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { CheckSmallIcon } from "@igniter/ui/assets";

interface PaginationProps {
  totalPages: number;
  currentPage: number;
  onPageChange: (pageIndex: number) => void;
  disabled?: boolean;
}

export default function Pagination({
  totalPages,
  currentPage,
  onPageChange,
  disabled,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-end space-x-2 py-4">
      <DropdownMenu>
        <DropdownMenuTrigger disabled={totalPages <= 1 || disabled}>
          <div className="flex items-center gap-2 p-2">
            <span className="text-sm">
              Page {totalPages === 0 ? 0 : currentPage + 1} of {totalPages}
            </span>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">
          {Array.from({ length: totalPages }, (_, i) => (
            <DropdownMenuItem
              key={i}
              className="min-w-[130px] px-4 py-2 cursor-pointer rounded-lg flex items-center justify-between hover:bg-bg-hover"
              onClick={() => onPageChange(i)}
            >
              <span className="text-sm">Page {i + 1}</span>
              {currentPage === i && <CheckSmallIcon />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
