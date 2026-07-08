'use client'

import { useEffect, useState } from 'react'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { Button } from '@igniter/ui/components/button'
import { Checkbox } from '@igniter/ui/components/checkbox'
import { ListProviders } from '@/actions/Providers'
import { ProviderOption } from '@/app/app/import-suppliers/types'
import { ProviderStatus } from '@igniter/db/middleman/enums'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'select-provider-step'])

interface SelectProviderStepProps {
  ownerAddress: string
  onProviderSelected: (provider: ProviderOption) => void
  onBack?: () => void
  onClose: () => void
}

interface ProviderListItem {
  id: number
  identity: string
  name: string
  status: ProviderStatus
  enabled: boolean
}

export function SelectProviderStep({
  ownerAddress,
  onProviderSelected,
  onBack,
  onClose,
}: SelectProviderStepProps) {
  const [providers, setProviders] = useState<ProviderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption | null>(null)

  useEffect(() => {
    async function fetchProviders() {
      try {
        setLoading(true)
        const allProviders = await ListProviders()
        // Filter to only enabled providers
        const enabledProviders = allProviders
          .filter((p) => p.enabled && p.visible)
          .map((p) => ({
            id: p.id,
            identity: p.identity,
            name: p.name,
            status: p.status,
            enabled: p.enabled,
          }))
        setProviders(enabledProviders)
        setError(null)
      } catch (err) {
        log.error('failed to fetch providers', { error: err })
        setError('Failed to load providers. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    fetchProviders()
  }, [])

  const handleProviderClick = (provider: ProviderListItem) => {
    setSelectedProvider({
      id: provider.id,
      identity: provider.identity,
      name: provider.name,
    })
  }

  const getStatusBadge = (status: ProviderStatus) => {
    const statusColors: Record<ProviderStatus, string> = {
      [ProviderStatus.Healthy]: 'bg-green-500/20 text-green-400',
      [ProviderStatus.Unhealthy]: 'bg-red-500/20 text-error',
      [ProviderStatus.Unknown]: 'bg-gray-500/20 text-text-tertiary',
      [ProviderStatus.Unreachable]: 'bg-yellow-500/20 text-yellow-400',
    }

    return (
      <span
        className={`px-2 py-0.5 rounded text-[10px] uppercase ${statusColors[status]}`}
      >
        {status}
      </span>
    )
  }

  return (
    <div className="flex relative flex-col w-[580px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Import Suppliers"
        subtitle="Select a provider to import your staked suppliers from."
        onClose={onClose}
        onBack={onBack}
      />

      <div className="flex flex-col gap-4 h-full overflow-y-auto max-h-[400px]">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-text-tertiary">Loading providers...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        {!loading && !error && providers.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-text-tertiary">No providers available.</p>
          </div>
        )}

        {!loading &&
          !error &&
          providers.map((provider) => (
            <div
              key={provider.identity}
              className={`w-full cursor-pointer select-none flex flex-row items-center gap-3 py-3 pl-4 pr-4 bg-(--input-bg) border rounded-lg transition-colors ${
                selectedProvider?.identity === provider.identity
                  ? 'border-border-focus'
                  : 'border-transparent hover:border-border-subtle'
              }`}
              onClick={() => handleProviderClick(provider)}
            >
              <div className="flex flex-col flex-1 gap-1">
                <p className="text-sm font-medium">{provider.name}</p>
                <p className="text-xs text-text-tertiary font-mono">
                  {provider.identity.substring(0, 16)}...
                </p>
              </div>
              {getStatusBadge(provider.status)}
              <Checkbox
                checked={selectedProvider?.identity === provider.identity}
              />
            </div>
          ))}
      </div>

      <div className="text-xs text-text-tertiary">
        <p>
          Importing will allow you to manage the suppliers you have staked with the selected provider here.
          The provider needs to have your suppliers loaded in their provider-side database.
        </p>
        <p className="mt-1">
          You will need to sign a message to verify ownership of the address.
        </p>
      </div>

      <Button
        disabled={!selectedProvider}
        className="w-full h-[40px]"
        onClick={() => selectedProvider && onProviderSelected(selectedProvider)}
      >
        Continue
      </Button>
    </div>
  )
}
