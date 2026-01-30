'use client';

import { ShareCalculation } from '@/lib/utils/shareCalculations';
import { ServicesPopover } from './ServicesPopover';
import React from 'react'

type AddressGroupService = {
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
}

export function PlanDetailsSection({
  addressGroupName,
  services,
  shares,
  className = '',
  delegatorFee = 0,
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
      <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)] text-[14px]">
        <span className="text-[14px] text-[var(--color-white-3)]">Services</span>
        <ServicesPopover
          addressGroupName={addressGroupName}
          services={services}
          servicesCount={servicesCount}
          triggerClassName="text-[13px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] underline cursor-pointer"
          delegatorFee={delegatorFee}
          larger={false}
        />
      </span>
    </>
  );
}
