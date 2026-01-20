'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { UpdateDelegatorsFromSource } from '@/actions/Delegators'
import { Button } from '@igniter/ui/components/button'
import { LoaderIcon } from '@igniter/ui/assets'

export default function RefreshDelegators() {
  const queryClient = useQueryClient();
  const [isUpdatingDelegators, setIsUpdatingDelegators] = React.useState(false);

  const reloadDelegators = async () => {
    // TODO: Error handling and display
    try {
      setIsUpdatingDelegators(true);
      const result = await UpdateDelegatorsFromSource();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: ['delegators'] });
    } catch (error) {
      console.error("Failed to update delegators from source:", error);
    } finally {
      setIsUpdatingDelegators(false);
    }
  }

  return (
    <Button
      variant={"outline"}
      onClick={reloadDelegators}
      disabled={isUpdatingDelegators}
    >
      {isUpdatingDelegators ? (
        <LoaderIcon className="animate-spin" />
      ) : (
        "Reload"
      )}
    </Button>
  )
}
