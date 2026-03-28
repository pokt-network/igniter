'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { AddOrUpdateRegionDialog } from '@/components/AddOrUpdateRegionDialog'
import { Button } from '@igniter/ui/components/button'

export default function AddNewRegion() {
  const queryClient = useQueryClient();
  const [isAddingRegion, setIsAddingRegion] = React.useState(false);

  return (
    <>
      {isAddingRegion && (
        <AddOrUpdateRegionDialog
          onClose={(shouldRefreshRegions) => {
            setIsAddingRegion(false);
            if (shouldRefreshRegions) {
              queryClient.invalidateQueries({queryKey: ['regions']});
            }
          }}
        />
      )}
      <Button
        onClick={() => setIsAddingRegion(true)}
      >
        Add Region
      </Button>
    </>
  )
}
