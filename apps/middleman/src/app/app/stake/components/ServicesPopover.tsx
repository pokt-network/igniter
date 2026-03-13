'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover';
import { CaretSmallIcon } from '@igniter/ui/assets';

const VISIBLE_COUNT = 18;

const REWARDS_STALE_MS = 48 * 60 * 60 * 1000;

type AddressGroupService = {
  serviceId: string;
  addSupplierShare: boolean;
  supplierShare: number;
  revShare?: Array<{
    address: string;
    share: number;
  }>;
  service: {
    name: string;
  };
};

type ServiceReward = {
  service_id: string;
  amount: string;
  staked_suppliers?: number;
};

export interface ServicesPopoverProps {
  addressGroupName: string;
  services: AddressGroupService[];
  delegatorFee?: number;
  grossRewardsPerService?: ServiceReward[];
  rewardsSuppliersCount?: number;
  rewardsUpdatedAt?: string;
  planEstYield?: string | null;
  planClientShare?: string | null;
  planApr?: string | null;
  planPerformance?: string | null;
  /** @deprecated no longer used, kept for call-site compatibility */
  triggerClassName?: string;
  /** @deprecated no longer used, kept for call-site compatibility */
  larger?: boolean;
  /** @deprecated no longer used, kept for call-site compatibility */
  onTriggerClick?: (e: React.MouseEvent) => void;
}

const CHIP_COLORS = [
  'bg-blue-500/15 text-blue-300 border-blue-500/30 group-hover:bg-blue-500/25 group-hover:text-blue-200 group-hover:border-blue-400/50',
  'bg-teal-500/15 text-teal-300 border-teal-500/30 group-hover:bg-teal-500/25 group-hover:text-teal-200 group-hover:border-teal-400/50',
  'bg-purple-500/15 text-purple-300 border-purple-500/30 group-hover:bg-purple-500/25 group-hover:text-purple-200 group-hover:border-purple-400/50',
  'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 group-hover:bg-cyan-500/25 group-hover:text-cyan-200 group-hover:border-cyan-400/50',
  'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 group-hover:bg-indigo-500/25 group-hover:text-indigo-200 group-hover:border-indigo-400/50',
  'bg-amber-500/15 text-amber-300 border-amber-500/30 group-hover:bg-amber-500/25 group-hover:text-amber-200 group-hover:border-amber-400/50',
  'bg-rose-500/15 text-rose-300 border-rose-500/30 group-hover:bg-rose-500/25 group-hover:text-rose-200 group-hover:border-rose-400/50',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 group-hover:bg-emerald-500/25 group-hover:text-emerald-200 group-hover:border-emerald-400/50',
  'bg-sky-500/15 text-sky-300 border-sky-500/30 group-hover:bg-sky-500/25 group-hover:text-sky-200 group-hover:border-sky-400/50',
  'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30 group-hover:bg-fuchsia-500/25 group-hover:text-fuchsia-200 group-hover:border-fuchsia-400/50',
  'bg-lime-500/15 text-lime-300 border-lime-500/30 group-hover:bg-lime-500/25 group-hover:text-lime-200 group-hover:border-lime-400/50',
  'bg-orange-500/15 text-orange-300 border-orange-500/30 group-hover:bg-orange-500/25 group-hover:text-orange-200 group-hover:border-orange-400/50',
  'bg-violet-500/15 text-violet-300 border-violet-500/30 group-hover:bg-violet-500/25 group-hover:text-violet-200 group-hover:border-violet-400/50',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getChipColor(serviceId: string): string {
  return CHIP_COLORS[hashString(serviceId) % CHIP_COLORS.length]!;
}

type ServiceStats = { performance: number; stakedSuppliers: number };

function PlanSummaryBar({
  estYield,
  clientShare,
  apr,
  performance,
}: {
  estYield?: string | null;
  clientShare?: string | null;
  apr?: string | null;
  performance?: string | null;
}) {
  return (
    <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 mx-3 mb-2 rounded bg-[var(--color-slate-1)] border border-[var(--slate-dividers)] text-[11px]">
      <span className="text-[var(--color-white-3)]">
        Est. Yield: <span className="font-mono text-[var(--color-white-1)]">{estYield ?? '—'}</span>
      </span>
      <span className="text-[var(--color-white-3)]">
        Client Share: <span className="font-mono text-[var(--color-white-1)]">{clientShare ?? '—'}</span>
      </span>
      <span className="text-[var(--color-white-3)]">
        Performance: <span className="font-mono text-[var(--color-white-1)]">{performance ?? '—'}</span>
      </span>
      <span className="text-[var(--color-white-3)]">
        APR: <span className="font-mono text-[var(--color-white-1)]">{apr ?? '—'}</span>
      </span>
    </div>
  );
}

function MetricsFooter({ rewardsFresh }: { rewardsFresh: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="sticky bottom-0 border-t border-[var(--slate-dividers)] bg-[var(--color-slate-2)]">
      <button
        type="button"
        className="flex items-center justify-between w-full px-4 py-2 border-none outline-none bg-transparent text-[10px] text-[var(--color-white-3)] hover:text-[var(--color-white-2)] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>
          {rewardsFresh ? 'Performance & Est. Yield in POKT/supplier/day' : 'How are these metrics calculated?'}
        </span>
        <span className="flex items-center gap-1">
          <span>{isExpanded ? 'Hide' : 'About the Metrics'}</span>
          <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            <CaretSmallIcon />
          </span>
        </span>
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-3 px-4 pb-3 text-[11px]">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--color-white-2)]">Est. Yield</span>
            <span className="text-[var(--color-white-3)]">Performance × Client Share — your net earnings per supplier per day.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--color-white-2)]">Client Share</span>
            <span className="text-[var(--color-white-3)]">100% − Provider Share − Supplier Share − Delegator Fee. Median across all services.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--color-white-2)]">Performance</span>
            <span className="text-[var(--color-white-3)]">Gross POKT earned per supplier per day, averaged over the last 7 days.</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-[var(--color-white-2)]">APR</span>
            <span className="text-[var(--color-white-3)]">Annual Percentage Rate: (Est. Yield × 365 ÷ minimum stake) × 100.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ServicesPopover({
  addressGroupName,
  services,
  delegatorFee = 0,
  grossRewardsPerService,
  rewardsSuppliersCount,
  rewardsUpdatedAt,
  planEstYield,
  planClientShare,
  planApr,
  planPerformance,
}: ServicesPopoverProps) {
  if (services.length === 0) return null;

  const visibleServices = services.slice(0, VISIBLE_COUNT);
  const hiddenCount = services.length - VISIBLE_COUNT;

  const rewardsFresh =
    !!rewardsUpdatedAt &&
    Date.now() - new Date(rewardsUpdatedAt).getTime() < REWARDS_STALE_MS;

  const rewardsMap = new Map<string, ServiceStats>(
    rewardsFresh
      ? (grossRewardsPerService ?? []).flatMap((r) => {
          const suppliers = r.staked_suppliers || rewardsSuppliersCount;
          if (!suppliers) return [];
          return [[r.service_id, {
            performance: parseFloat(r.amount) / 1e6 / suppliers / 7,
            stakedSuppliers: suppliers,
          }] as [string, ServiceStats]];
        })
      : []
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <section
          className="group flex flex-col gap-2 cursor-pointer rounded-md p-2 -mx-2 hover:bg-[var(--color-slate-1)] transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header row */}
          <div className="flex flex-row items-center justify-between">
            <p className="text-[11px] font-medium text-[var(--color-white-3)] group-hover:text-[var(--color-white-2)] transition-colors">
              Services
            </p>
            <p className="flex items-center gap-1 px-2 py-0.5 rounded border border-transparent group-hover:border-[var(--slate-dividers)] text-[11px] font-medium text-[var(--color-white-3)] group-hover:text-[var(--color-white-1)] transition-all">
              View more
              <span className="transition-transform group-hover:translate-x-0.5">
                <CaretSmallIcon />
              </span>
            </p>
          </div>
          {/* Chips */}
          <div className="flex flex-row flex-wrap gap-1.5">
            {visibleServices.map((svc) => (
              <span
                key={svc.serviceId}
                className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${getChipColor(svc.serviceId)}`}
                title={svc.serviceId}
              >
                {svc.serviceId}
              </span>
            ))}
            {hiddenCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-medium rounded border border-dashed border-[var(--slate-dividers)] text-[var(--color-white-3)] group-hover:text-[var(--color-white-1)] group-hover:border-[var(--color-white-3)] transition-colors">
                +{hiddenCount} more
              </span>
            )}
          </div>
        </section>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="flex flex-col w-[460px] bg-[var(--color-slate-2)] p-0 max-h-[500px] overflow-hidden border-2 border-[var(--black-dividers)] shadow-[0_8px_16px_rgba(0,0,0,0.4)]"
      >
        <div className="sticky top-0 bg-[var(--color-slate-2)] border-b border-[var(--slate-dividers)] z-10">
          <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[12px_16px] block">
            {addressGroupName} — Plan Summary
          </span>
          <PlanSummaryBar
            estYield={planEstYield}
            clientShare={planClientShare}
            apr={planApr}
            performance={planPerformance}
          />
          <div className="grid grid-cols-[1fr_60px_repeat(3,_70px)] gap-2 px-4 pb-2 text-[11px] text-[var(--color-white-3)] font-medium">
            <span>Service</span>
            <span className="text-right">Suppliers</span>
            <span className="text-right">Performance</span>
            <span className="text-right">Est. Yield</span>
            <span className="text-right">Client Share</span>
          </div>
        </div>
        <div className="flex flex-col overflow-y-auto">
          {services.map((service, sIndex) => {
            const totalProviderShare =
              service.revShare?.reduce((sum, rev) => sum + rev.share, 0) || 0;
            const supplierShare = service.addSupplierShare ? service.supplierShare : 0;
            const clientShare = 100 - totalProviderShare - supplierShare - delegatorFee;
            const stats = rewardsMap.get(service.serviceId) ?? null;
            const estYield = stats !== null ? stats.performance * (clientShare / 100) : null;

            return (
              <div
                key={sIndex}
                className={`grid grid-cols-[1fr_60px_repeat(3,_70px)] gap-2 items-center px-4 py-2 ${
                  sIndex !== services.length - 1 ? 'border-b border-[var(--slate-dividers)]' : ''
                }`}
              >
                <span className="text-[13px] text-[var(--color-white-1)] truncate" title={service.serviceId}>
                  {service.serviceId}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-white-3)] text-right">
                  {stats !== null ? stats.stakedSuppliers.toLocaleString() : '—'}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-white-3)] text-right">
                  {stats !== null ? stats.performance.toFixed(2) : '—'}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-white-1)] text-right">
                  {estYield !== null ? estYield.toFixed(2) : '—'}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-white-3)] text-right">
                  {clientShare.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
        <MetricsFooter rewardsFresh={rewardsFresh} />
      </PopoverContent>
    </Popover>
  );
}
