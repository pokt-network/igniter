'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { AddOrUpdateAddressGroupDialog } from '@/components/AddOrUpdateAddressGroupDialog'
import { Button } from '@igniter/ui/components/button'

export default function AddNewAddressGroup() {
  const queryClient = useQueryClient();
  const [isAddingGroup, setIsAddingGroup] = React.useState(false);

  return (
    <>
      {isAddingGroup && (
        <AddOrUpdateAddressGroupDialog
          onClose={(shouldRefreshAddressGroups) => {
            setIsAddingGroup(false);
            if (shouldRefreshAddressGroups) {
              queryClient.invalidateQueries({queryKey: ['groups']});
            }
          }}
        />
      )}
      <Button
        onClick={() => setIsAddingGroup(true) }
      >
        Add Group
      </Button>
    </>
  )
}
