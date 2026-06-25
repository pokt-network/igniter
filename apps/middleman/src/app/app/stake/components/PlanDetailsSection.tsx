'use client';

import { ShareCalculation, hasNonUniformClientShare } from '@/lib/utils/shareCalculations';
import { ServicesPopover } from './ServicesPopover';
import { WarningIcon } from '@igniter/ui/assets';
import React from 'react'

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

export interface PlanDetailsSectionProps {
  addressGroupName: string;
  services: AddressGroupService[];
  shares: ShareCalculation;
  className?: string;
  delegatorFee?: number;
  grossRewardsPerService?: Array<{ service_id: string; amount: string; staked_suppliers?: number }>;
  rewardsSuppliersCount?: number;
  rewardsUpdatedAt?: string;
}

export function PlanDetailsSection({
  addressGroupName,
  services,
  shares,
  className = '',
  delegatorFee = 0,
  grossRewardsPerService,
  rewardsSuppliersCount,
  rewardsUpdatedAt,
}: PlanDetailsSectionProps) {
  const nonUniformClientShare = hasNonUniformClientShare(
    { addressGroupServices: services },
    delegatorFee
  );

  return (
    <>
      {nonUniformClientShare ? (
        <span className="flex flex-row items-center gap-3 m-4 bg-warning-bg p-[11px_16px] rounded-[8px]">
          <WarningIcon className="shrink-0" />
          <span className="text-[14px] text-[var(--text-primary)]">
            Revshare priced per service, please expand service.
          </span>
        </span>
      ) : (
        <>
          <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
            <span className="text-[14px] text-[var(--text-tertiary)]">Provider Share</span>
            <span className="text-[14px] font-mono text-[var(--text-primary)] mt-[4px]">
              {shares.providerShare.toFixed(1)}%
            </span>
          </span>
          <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
            <span className="text-[14px] text-[var(--text-tertiary)]">Supplier Share</span>
            <span className="text-[14px] font-mono text-[var(--text-primary)] mt-[4px]">
              {shares.supplierShare.toFixed(1)}%
            </span>
          </span>
          <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
            <span className="text-[14px] text-[var(--text-tertiary)]">Delegator Fee</span>
            <span className="text-[14px] font-mono text-[var(--text-primary)] mt-[4px]">
              {shares.delegatorShare.toFixed(1)}%
            </span>
          </span>
          <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
            <span className="text-[14px] text-[var(--text-tertiary)]">Client Share</span>
            <span className="text-[14px] font-mono text-[var(--text-primary)] mt-[4px]">
              {shares.clientShare.toFixed(1)}%
            </span>
          </span>
        </>
      )}
      <div className="flex flex-row items-center justify-between pl-4 py-3 border-b border-[var(--border-primary)] text-[14px] w-full [&_p]:text-[14px] [&_p]:font-normal [&_section]:w-full [&_section]:mr-0 ">
        <ServicesPopover
          addressGroupName={addressGroupName}
          services={services}
          delegatorFee={delegatorFee}
          grossRewardsPerService={grossRewardsPerService}
          rewardsSuppliersCount={rewardsSuppliersCount}
          rewardsUpdatedAt={rewardsUpdatedAt}
          nonUniformClientShare={nonUniformClientShare}
        />
      </div>
    </>
  );
}
