"use client";

import { useState } from 'react';
import { Button } from '@igniter/ui/components/button';
import { UnstakeProcess } from '@/app/app/unstake/components/UnstakeProcess';

/**
 * Bulk unstake entry from the suppliers list. Opens the unstake flow as a modal
 * (owner + supplier selection). Single-supplier unstakes start from the supplier
 * detail with the supplier pre-selected instead.
 */
export function UnstakeButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className="border-error text-error hover:bg-error/10"
        onClick={() => setOpen(true)}
      >
        Unstake
      </Button>
      <UnstakeProcess open={open} onOpenChange={setOpen} />
    </>
  );
}
