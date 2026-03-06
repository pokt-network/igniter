'use client';

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
  servicesCount: number;
  delegatorFee?: number;
  grossRewardsPerService?: ServiceReward[];
  rewardsSuppliersCount?: number;
  rewardsUpdatedAt?: string;
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
];

export function ServicesPopover({
  addressGroupName,
  services,
  delegatorFee = 0,
  grossRewardsPerService,
  rewardsSuppliersCount,
  rewardsUpdatedAt,
}: ServicesPopoverProps) {
  if (services.length === 0) return null;

  const visibleServices = services.slice(0, VISIBLE_COUNT);
  const hiddenCount = services.length - VISIBLE_COUNT;

  const rewardsFresh =
    !!rewardsUpdatedAt &&
    Date.now() - new Date(rewardsUpdatedAt).getTime() < REWARDS_STALE_MS;

  type ServiceStats = { performance: number; stakedSuppliers: number };
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
            {visibleServices.map((svc, i) => (
              <span
                key={i}
                className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${CHIP_COLORS[i % CHIP_COLORS.length]}`}
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
            Services for {addressGroupName}
          </span>
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
        {rewardsFresh && (
          <div className="sticky bottom-0 border-t border-[var(--slate-dividers)] px-4 py-2 bg-[var(--color-slate-2)]">
            <span className="text-[10px] text-[var(--color-white-3)]">Performance & Est. Yield in POKT/supplier/day</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
