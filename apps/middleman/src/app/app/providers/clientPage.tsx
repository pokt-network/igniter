"use client";

import React, { useState, useEffect } from 'react';
import millify from 'millify'
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
import { calculateShares, calculateAddressGroupPerformance, calculateEffectiveYield, formatPerformance } from '@/lib/utils/shareCalculations';
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
        minimumStake: appSettings.minimumStake ?? 0,
      };
    },
    enabled: isConnected,
    refetchInterval: 30000,
  });

  const providers = data?.providers || [];
  const delegatorFee = data?.delegatorFee || 0;
  const minimumStake = data?.minimumStake || 0;

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
          <MasonryGrid>
            {providers.map(provider => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isExpanded={expandedProviders.has(provider.id)}
                onToggleExpand={() => toggleExpanded(provider.id)}
                onStakeClick={handleStakeClick}
                delegatorFee={delegatorFee}
                connectedAccounts={connectedIdentities || []}
                minimumStake={minimumStake}
              />
            ))}
          </MasonryGrid>
        )}
      </div>
    </>
  );
}

function useMasonryColumns(minItemWidth = 700): number {
  const [count, setCount] = useState(() => {
    if (typeof window === 'undefined') return 3;
    return Math.max(1, Math.floor(window.innerWidth / minItemWidth));
  });

  useEffect(() => {
    const update = () =>
      setCount(Math.max(1, Math.floor(window.innerWidth / minItemWidth)));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [minItemWidth]);

  return count;
}

function MasonryGrid({ children }: { children: React.ReactNode[] }) {
  const columnCount = useMasonryColumns();
  const columns = Array.from({ length: columnCount }, (_, col) =>
    children.filter((_, i) => i % columnCount === col)
  );

  return (
    <div className="flex flex-row gap-6">
      {columns.map((col, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-6 flex-1 min-w-0">
          {col}
        </div>
      ))}
    </div>
  );
}

interface ProviderCardProps {
  provider: ProviderWithPublicPlans;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onStakeClick: (providerId: number, addressGroupId: number, linkedAccount?: string | null) => void;
  delegatorFee: number;
  connectedAccounts: string[];
  minimumStake: number;
}

function ProviderCard({
  provider,
  isExpanded,
  onToggleExpand,
  onStakeClick,
  delegatorFee,
  connectedAccounts,
  minimumStake,
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
                      About these metrics
                    </span>
                    <div className="flex flex-col gap-4 p-[12px_16px]">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[var(--color-white-1)]">Est. Yield</span>
                        <span className="text-[13px] text-[var(--color-white-3)]">
                          Your estimated earnings per supplier per day, calculated as: Performance × Client Share.
                          This is the net amount you would receive after all fees are applied.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[var(--color-white-1)]">Client Share</span>
                        <span className="text-[13px] text-[var(--color-white-3)]">
                          The median share of rewards you will receive across all services in this plan.
                          Calculated per service as: 100% − Provider Share − Supplier Share − Delegator Fee, then the median is taken.
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-[var(--color-white-1)]">APR</span>
                        <span className="text-[13px] text-[var(--color-white-3)]">
                          Annual Percentage Rate, estimated from recent performance.
                          Calculated as: (Est. Yield POKT/supplier/day × 365 ÷ minimum stake) × 100.
                        </span>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </span>
              <span className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[var(--color-white-3)]">
                <span className="whitespace-nowrap">Plans: <span className="text-[var(--color-white-1)]">{provider.addressGroups.length}</span></span>
                {provider.supplierStats && (
                  <>
                    <span className="whitespace-nowrap">Suppliers: <span className="text-[var(--color-white-1)]">{provider.supplierStats.suppliers_count.toLocaleString()}</span></span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="whitespace-nowrap">Total Staked: <span className="text-[var(--color-white-1)]">{millify(provider.supplierStats.total_staked_tokens / 1e6, { precision: 1 })} POKT</span></span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {(provider.supplierStats.total_staked_tokens / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} POKT
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
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
              const linkedAccount = getLinkedAccount(addressGroup.linkedAddresses);
              const planPerformance = calculateAddressGroupPerformance(addressGroup);
              const effectiveYield = calculateEffectiveYield(planPerformance, shares.clientShare);
              const apr = effectiveYield !== null && minimumStake > 0
                ? (effectiveYield * 365 / minimumStake) * 100
                : null;

              return (
                <div
                  key={addressGroup.id}
                  className={`flex flex-col gap-1 p-[16px_25px] ${
                    index !== sortedAddressGroups.length - 1
                      ? 'border-b border-[var(--black-dividers)]'
                      : ''
                  }`}
                >
                  {/* Top row: plan name + actions */}
                  <div className="flex flex-row items-center justify-between">
                    <span className="flex flex-row items-center gap-2">
                      <span className="font-medium">Plan #{index + 1}: {addressGroup.name}</span>
                      {linkedAccount && (
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
                      )}
                    </span>
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
                  {/* Metrics row */}
                  <div className="flex flex-row gap-6 mt-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[var(--color-white-3)]">Est. Yield</span>
                      <span className="font-mono text-[13px]">{effectiveYield !== null ? formatPerformance(effectiveYield) : '—'}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[var(--color-white-3)]">Client Share</span>
                      <span className="font-mono text-[13px]">{shares.clientShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[var(--color-white-3)]">APR</span>
                      <span className="font-mono text-[13px]">{apr !== null ? `${apr.toFixed(1)}%` : '—'}</span>
                    </div>
                  </div>
                  {/* Services row */}
                  <ServicesPopover
                    addressGroupName={addressGroup.name}
                    services={addressGroup.addressGroupServices || []}
                    delegatorFee={delegatorFee}
                    grossRewardsPerService={addressGroup.grossRewardsPerService}
                    rewardsSuppliersCount={addressGroup.rewardsSuppliersCount}
                    rewardsUpdatedAt={addressGroup.rewardsUpdatedAt}
                    planEstYield={effectiveYield !== null ? formatPerformance(effectiveYield) : null}
                    planClientShare={`${shares.clientShare.toFixed(1)}%`}
                    planPerformance={planPerformance !== null ? formatPerformance(planPerformance) : null}
                    planApr={apr !== null ? `${apr.toFixed(1)}%` : null}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
