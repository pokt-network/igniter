"use client";

import { Badge } from "@igniter/ui/components/badge";

export function PendingBadge({ kind }: { kind: 'stake' | 'unstake' }) {
  if (kind === 'unstake') {
    return <Badge variant="warning">Unstaking…</Badge>;
  }
  return <Badge variant="info">Staking…</Badge>;
}
