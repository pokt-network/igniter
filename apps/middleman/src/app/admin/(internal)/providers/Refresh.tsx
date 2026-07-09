'use client'

import { useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { TriggerGovernanceSync } from '@/actions/Providers'
import { Button } from '@igniter/ui/components/button'
import { LoaderIcon } from '@igniter/ui/assets'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'refresh-providers'])

export default function RefreshProviders() {
  const queryClient = useQueryClient();
  const [isUpdatingProviders, setIsUpdatingProviders] = React.useState(false);

  const reloadDelegators = async () => {
    // TODO: Error handling and display
    try {
      setIsUpdatingProviders(true);
      await TriggerGovernanceSync();
      // Give the workflow a moment to complete before refreshing
      await new Promise(resolve => setTimeout(resolve, 2000));
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (error) {
      log.error("failed to update providers from source", { error });
    } finally {
      setIsUpdatingProviders(false);
    }
  }

  return (
    <Button
      variant={"outline"}
      onClick={reloadDelegators}
      disabled={isUpdatingProviders}
    >
      {isUpdatingProviders ? (
        <LoaderIcon className="animate-spin" />
      ) : (
        "Reload"
      )}
    </Button>
  )
}
