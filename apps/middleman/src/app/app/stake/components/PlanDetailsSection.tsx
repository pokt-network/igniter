'use client';

import { ShareCalculation } from '@/lib/utils/shareCalculations';
import { ServicesPopover } from './ServicesPopover';
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
  const servicesCount = services.length;

  return (
    <>
      <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
        <span className="text-[14px] text-[var(--color-white-3)]">Client Share</span>
        <span className="text-[14px] font-mono text-[var(--color-white-1)] mt-[4px]">
          {shares.clientShare.toFixed(1)}%
        </span>
      </span>
      <div className="flex flex-row items-center justify-between pl-4 py-3 border-b border-[var(--black-dividers)] text-[14px] w-full [&_p]:text-[14px] [&_p]:font-normal [&_section]:w-full [&_section]:mr-0 ">
        <ServicesPopover
          addressGroupName={addressGroupName}
          services={services}
          servicesCount={servicesCount}
          delegatorFee={delegatorFee}
          grossRewardsPerService={grossRewardsPerService}
          rewardsSuppliersCount={rewardsSuppliersCount}
          rewardsUpdatedAt={rewardsUpdatedAt}
        />
      </div>
    </>
  );
}
