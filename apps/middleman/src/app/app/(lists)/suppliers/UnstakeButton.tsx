"use client";

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@igniter/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@igniter/ui/components/tooltip';
import { UnstakeProcess } from '@/app/app/unstake/components/UnstakeProcess';
import { GetUserNodes } from '@/actions/Nodes';
import { usePendingGuards } from '@/lib/pending/usePendingGuards';
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index';

/**
 * Bulk unstake entry from the suppliers list. Opens the unstake flow as a modal
 * (owner + supplier selection). Single-supplier unstakes start from the supplier
 * detail with the supplier pre-selected instead.
 *
 * Disabled (with tooltip) when the wallet is connected and every supplier is blocked
 * by an in-flight operation, to prevent leading the user into an empty modal.
 * Re-uses the ['nodes'] cache already populated by the table on this page.
 */
export function UnstakeButton() {
  const [open, setOpen] = useState(false);
  const { connectedIdentities, isConnected } = useWalletConnection();
  const { isOperatorPending, isOwnerBusy } = usePendingGuards();

  const { data: nodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: GetUserNodes,
    refetchInterval: 60000,
    // Only run when connected — mirrors how the table fetches data.
    enabled: isConnected,
  });

  // True when at least one supplier is staked and not blocked by a pending op on
  // either the operator or the owner signer. If nodes haven't loaded yet we
  // optimistically allow opening so the modal's own loader handles the wait.
  const hasActionableSupplier = useMemo(() => {
    if (!nodes || !connectedIdentities) return true; // not yet loaded → optimistic
    return nodes.some(
      node =>
        node.status === 'staked' &&
        connectedIdentities.includes(node.ownerAddress) &&
        !isOperatorPending(node.address) &&
        !isOwnerBusy(node.ownerAddress),
    );
  }, [nodes, connectedIdentities, isOperatorPending, isOwnerBusy]);

  const isDisabled = isConnected && !hasActionableSupplier;

  const button = (
    <Button
      variant="outline"
      className="border-error text-error hover:bg-error/10"
      onClick={() => !isDisabled && setOpen(true)}
      disabled={isDisabled}
    >
      Unstake
    </Button>
  );

  return (
    <>
      {isDisabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Wrap in a span so the tooltip works on a disabled button */}
            <span className="inline-flex">{button}</span>
          </TooltipTrigger>
          <TooltipContent>
            All your suppliers have an operation in progress
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <UnstakeProcess open={open} onOpenChange={setOpen} />
    </>
  );
}
