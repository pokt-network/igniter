'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { AddOrUpdateRelayMinerDialog } from '@/components/AddOrUpdateRelayMinerDialog'
import { Button } from '@igniter/ui/components/button'

export default function AddNewRelayMiner() {
  const queryClient = useQueryClient();
  const [isAddingMiner, setIsAddingMiner] = React.useState(false);

  return (
    <>
      {isAddingMiner && (
        <AddOrUpdateRelayMinerDialog
          onClose={(shouldRefreshRelayMiners) => {
            setIsAddingMiner(false);
            if (shouldRefreshRelayMiners) {
              queryClient.invalidateQueries({queryKey: ['relay-miners']});
            }
          }}
        />
      )}
      <Button
        onClick={() => setIsAddingMiner(true) }
      >
        Add Relay Miner
      </Button>
    </>
  )
}
