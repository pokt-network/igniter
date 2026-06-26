'use client';

import { useQuery } from '@tanstack/react-query';
import { GetPendingState } from '@/actions/Pending';
import type { PendingStateSerialized } from '@/lib/pending/derivePendingState';

function hasPending(state: PendingStateSerialized | undefined): boolean {
  if (!state) return false;
  return Object.keys(state.byOperator).length > 0 || state.pendingStakeOperators.length > 0;
}

export function usePendingGuards() {
  const { data } = useQuery({
    queryKey: ['pendingState'],
    queryFn: GetPendingState,
    refetchInterval: (q) => hasPending(q.state.data) ? 7000 : false,
  });

  function isOperatorPending(addr: string): boolean {
    if (!data) return false;
    return addr in data.byOperator;
  }

  function isOwnerBusy(owner: string): boolean {
    if (!data) return false;
    return owner in data.byOwner;
  }

  return { isOperatorPending, isOwnerBusy };
}
