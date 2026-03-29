'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { AddOrUpdateServiceDialog } from '@/components/AddOrUpdateServiceDialog'
import { Button } from '@igniter/ui/components/button'

export default function AddNewService() {
  const queryClient = useQueryClient();
  const [isAddingService, setIsAddingService] = React.useState(false);

  return (
    <>
      {isAddingService && (
        <AddOrUpdateServiceDialog
          onClose={(shouldRefreshServices) => {
            setIsAddingService(false);
            if (shouldRefreshServices) {
              queryClient.invalidateQueries({queryKey: ['services']});
            }
          }}
        />
      )}
      <Button
        onClick={() => setIsAddingService(true) }
      >
        Add Service
      </Button>
    </>
  )
}
