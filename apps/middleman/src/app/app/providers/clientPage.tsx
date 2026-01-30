"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@igniter/ui/components/button';
import { getShortAddress } from '@igniter/ui/lib/utils';
import { CaretIcon, InfoIcon } from '@igniter/ui/assets';
import { ProviderStatus } from '@igniter/db/middleman/enums';
import AvatarByString from '@igniter/ui/components/AvatarByString';
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index';
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover';
import { ListProvidersWithPublicPlans, ProviderWithPublicPlans } from '@/actions/Providers';
import { ServicesPopover } from '@/app/app/stake/components/ServicesPopover';
import { getApplicationSettings } from '@/actions/ApplicationSettings';
import ProviderIcon from '@/app/assets/icons/dark/providers.svg';
import { calculateShares } from '@/lib/utils/shareCalculations';
import { Tooltip, TooltipContent, TooltipTrigger } from '@igniter/ui/components/tooltip'

export default function ClientProvidersPage() {
  const router = useRouter();
  const { isConnected, connectedIdentities } = useWalletConnection();
  const [expandedProviders, setExpandedProviders] = useState<Set<number>>(new Set());
  const [hasInitializedExpanded, setHasInitializedExpanded] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['providers', connectedIdentities],
    queryFn: async () => {
      const [providersData, appSettings] = await Promise.all([
        ListProvidersWithPublicPlans(connectedIdentities || []),
        getApplicationSettings(),
      ]);
      return {
        providers: providersData,
        delegatorFee: appSettings.fee ? Number(appSettings.fee) : 0,
      };
    },
    enabled: isConnected,
    refetchInterval: 30000,
  });

  const providers = data?.providers || [];
  const delegatorFee = data?.delegatorFee || 0;

  useEffect(() => {
    if (!hasInitializedExpanded && providers.length > 0) {
      const autoExpand = new Set<number>();
      providers.forEach(p => {
        if (p.addressGroups.length === 1) {
          autoExpand.add(p.id);
        }
      });
      setExpandedProviders(autoExpand);
      setHasInitializedExpanded(true);
    }
  }, [providers, hasInitializedExpanded]);

  const toggleExpanded = (providerId: number) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const handleStakeClick = (providerId: number, addressGroupId: number, linkedAccount?: string | null) => {
    const params = new URLSearchParams({
      providerId: providerId.toString(),
      addressGroupId: addressGroupId.toString(),
    });
    if (linkedAccount) {
      params.set('linkedAccount', linkedAccount);
    }
    router.push(`/app/stake?${params.toString()}`);
  };

  return (
    <>
      <div className="border-b-1">
        <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-10">
          <div className="flex flex-row justify-between items-center">
            <div className="flex flex-col">
              <h1>Providers</h1>
              <p className="text-muted-foreground">
                Browse available node runners and their staking plans.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10">
        {isLoading || (!data && !isError) && (
          <div className="animate-pulse grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(600px, 1fr))' }}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-24 bg-[var(--color-slate-2)] rounded-lg" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <span className="text-[14px] text-[var(--color-white-3)]">
              Failed to load providers. Please try again.
            </span>
            <Button variant="outline" onClick={() => refetch()}>
              Reload
            </Button>
          </div>
        )}

        {!isLoading && !isError && !!data && providers.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <span className="text-[14px] text-[var(--color-white-3)]">
              No providers available at this time.
            </span>
          </div>
        )}

        {!isLoading && !isError && providers.length > 0 && (
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(600px, 1fr))' }}>
            {providers.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isExpanded={expandedProviders.has(provider.id)}
                onToggleExpand={() => toggleExpanded(provider.id)}
                onStakeClick={handleStakeClick}
                delegatorFee={delegatorFee}
                connectedAccounts={connectedIdentities || []}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface ProviderCardProps {
  provider: ProviderWithPublicPlans;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStakeClick: (providerId: number, addressGroupId: number, linkedAccount?: string | null) => void;
  delegatorFee: number;
  connectedAccounts: string[];
}

function ProviderCard({
  provider,
  isExpanded,
  onToggleExpand,
  onStakeClick,
  delegatorFee,
  connectedAccounts,
}: ProviderCardProps) {
  const normalizedConnectedAccounts = connectedAccounts.map(addr => addr.toLowerCase());

  const getLinkedAccount = (linkedAddresses: string[] | undefined): string | null => {
    if (!linkedAddresses || linkedAddresses.length === 0) return null;
    const linkedAccount = linkedAddresses.find(
      (addr: string) => normalizedConnectedAccounts.includes(addr.toLowerCase())
    );
    if (linkedAccount) {
      // Return the original (non-lowercased) connected account
      return connectedAccounts.find(
        (acc) => acc.toLowerCase() === linkedAccount.toLowerCase()
      ) || linkedAccount;
    }
    return null;
  };

  const sortedAddressGroups = [...provider.addressGroups].sort((a, b) => {
    const aLinkedAccount = getLinkedAccount(a.linkedAddresses);
    const bLinkedAccount = getLinkedAccount(b.linkedAddresses);

    if (aLinkedAccount && !bLinkedAccount) return -1;
    if (!aLinkedAccount && bLinkedAccount) return 1;
    return 0;
  });

  return (
    <div className="flex flex-col rounded-[8px] border-[2px] border-[--black-dividers]">
      <div className="flex flex-col bg-[var(--background)] rounded-[8px]">
        <div
          className="flex flex-row items-center justify-between p-[20px_25px] cursor-pointer hover:opacity-80"
          onClick={onToggleExpand}
        >
          <span className="flex flex-row items-center gap-5">
            <span>
              <ProviderIcon />
            </span>
            <span className="flex flex-col gap-2">
              <span className="flex flex-row items-center gap-2">
                <span>{provider.name}</span>
                <Popover>
                  <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <InfoIcon />
                  </PopoverTrigger>
                  <PopoverContent className="flex flex-col w-[360px] bg-[var(--color-slate-2)] p-0 max-h-[500px] overflow-y-auto">
                    <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[12px_16px] sticky top-0 bg-[var(--color-slate-2)] border-b border-[var(--slate-dividers)]">
                      About Client Share
                    </span>
                    <div className="flex flex-col gap-4 p-[12px_16px]">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[var(--color-white-1)]">Client Share</span>
                        <span className="text-[13px] text-[var(--color-white-3)]">
                          The share of the rewards you will receive from this plan.
                        </span>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </span>
              <span className="flex flex-row items-center gap-4 text-[14px]">
                <span>Performance: N/A</span>
                <span>Plans: {provider.addressGroups.length}</span>
                {provider.status !== ProviderStatus.Healthy && (
                  <span className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                    provider.status === ProviderStatus.Unhealthy ? 'bg-red-500/20 text-red-300' :
                      provider.status === ProviderStatus.Unreachable ? 'bg-orange-500/20 text-orange-300' :
                        'bg-yellow-500/20 text-yellow-300'
                  }`}>
                    {provider.status === ProviderStatus.Unhealthy ? 'Unhealthy' :
                      provider.status === ProviderStatus.Unreachable ? 'Unreachable' :
                        'Unknown'}
                  </span>
                )}
              </span>
            </span>
          </span>
          <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
            <CaretIcon />
          </span>
        </div>

        {isExpanded && (
          <div className="flex flex-col border-t border-[var(--black-dividers)]">
            {sortedAddressGroups.map((addressGroup, index) => {
              const shares = calculateShares(addressGroup, delegatorFee);
              const servicesCount = addressGroup.addressGroupServices?.length || 0;
              const linkedAccount = getLinkedAccount(addressGroup.linkedAddresses);

              return (
                <div
                  key={addressGroup.id}
                  className={`flex flex-col p-[16px_25px] ${
                    index !== sortedAddressGroups.length - 1
                      ? 'border-b border-[var(--black-dividers)]'
                      : ''
                  }`}
                >
                  <div className="flex flex-row items-center justify-between">
                    <span className="flex flex-row items-center gap-2">
                      <span className="font-medium">{addressGroup.name}</span>
                      {linkedAccount && (
                        <span className="flex flex-row items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <span className="flex flex-row items-center h-6 gap-1.5 pr-2 pl-1 py-0.5 text-[11px] font-medium bg-purple-500/20 text-purple-300 rounded">
                                <AvatarByString string={linkedAccount} size={18} />
                                <span className="font-mono">{getShortAddress(linkedAccount, 5)}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="flex flex-col w-[280px] bg-[var(--color-slate-2)] p-0 border-2 border-[var(--black-dividers)]">
                              <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[12px_16px]">
                                Personal Plan
                              </span>
                              <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
                              <span className="text-[13px] text-[var(--color-white-3)] p-[12px_16px]">
                                This plan is exclusively available to you based on your wallet address
                                <span className="font-mono text-[var(--color-white-1)] inline-flex items-center gap-2 mt-1">
                                  <AvatarByString string={linkedAccount} size={15} />
                                  <span>{getShortAddress(linkedAccount, 5)}</span>
                                </span>.
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                      )}
                      <span className="text-[var(--color-white-3)] -ml-2">:</span>
                      <span className="flex flex-row items-center gap-1.5 text-[14px] mt-0.5">
                        <span className="text-[var(--color-white-3)]">Client Share:</span>
                        <span className="font-mono mt-0.5">{shares.clientShare.toFixed(1)}%</span>
                      </span>
                    </span>
                    <div className="flex flex-row items-center gap-3">
                      <ServicesPopover
                        addressGroupName={addressGroup.name}
                        services={addressGroup.addressGroupServices || []}
                        servicesCount={servicesCount}
                        triggerClassName="text-[14px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] underline cursor-pointer"
                        delegatorFee={delegatorFee}
                      />
                      <Button
                        size="sm"
                        disabled={provider.status !== ProviderStatus.Healthy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStakeClick(provider.id, addressGroup.id, linkedAccount);
                        }}
                      >
                        Stake
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
