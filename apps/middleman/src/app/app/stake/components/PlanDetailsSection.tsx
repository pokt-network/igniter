'use client';

import { ShareCalculation } from '@/lib/utils/shareCalculations';
import { ServicesPopover } from './ServicesPopover';

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
    <span
      className={`flex flex-row items-center justify-between px-4 py-3 bg-[var(--color-slate-2)] border-b border-[var(--black-dividers)] ${className}`}
    >
      <div className="flex flex-row items-center gap-2 text-[13px]">
        <span className="text-[var(--color-white-3)]">Client Share:</span>
        <span className="font-mono text-[var(--color-white-1)] mt-1.5">
          {shares.clientShare.toFixed(1)}%
        </span>
      </div>
      <ServicesPopover
        addressGroupName={addressGroupName}
        services={services}
        servicesCount={servicesCount}
        triggerClassName="text-[13px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] underline cursor-pointer"
        delegatorFee={delegatorFee}
      />
    </span>
  );
}
