import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { CheckSmallIcon } from "@igniter/ui/assets";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  const canPrev = currentPage > 0 && !disabled
  const canNext = currentPage < totalPages - 1 && !disabled

  return (
    <div className="flex items-center justify-end space-x-1 py-4">
      <button
        className="flex items-center justify-center p-2 bg-(--input-bg) border rounded-lg hover:bg-secondary disabled:opacity-50 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground transition-colors"
        disabled={!canPrev}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger disabled={totalPages <= 1 || disabled}>
          <div className="flex items-center gap-2 p-2">
            <span className="text-sm">
              Page {totalPages === 0 ? 0 : currentPage + 1} of {totalPages}
            </span>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="max-h-60 overflow-y-auto">
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

      <button
        className="flex items-center justify-center p-2 bg-(--input-bg) border rounded-lg hover:bg-secondary disabled:opacity-50 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground transition-colors"
        disabled={!canNext}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
