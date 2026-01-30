'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover';

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

export interface ServicesPopoverProps {
  addressGroupName: string;
  services: AddressGroupService[];
  servicesCount: number;
  triggerClassName?: string;
  onTriggerClick?: (e: React.MouseEvent) => void;
  delegatorFee?: number;
  larger?: boolean
}

export function ServicesPopover({
  addressGroupName,
  services,
  servicesCount,
  larger = true,
  triggerClassName = !larger ? 'flex flex-row items-center gap-2' : "text-[14px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] underline cursor-pointer",
  onTriggerClick,
  delegatorFee = 0,
}: ServicesPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          className={triggerClassName}
          onClick={(e) => {
            e.stopPropagation();
            onTriggerClick?.(e);
          }}
        >
          {larger ? `Services: ${servicesCount}` : servicesCount}
        </span>
      </PopoverTrigger>
      <PopoverContent align={'center'} side={'top'} sideOffset={18} className="flex flex-col w-[320px] bg-[var(--color-slate-2)] p-0 max-h-[500px] overflow-hidden border-2 border-[var(--black-dividers)] shadow-[0_8px_16px_rgba(0,0,0,0.4)]">
        <div className="sticky top-0 bg-[var(--color-slate-2)] border-b border-[var(--slate-dividers)] z-10">
          <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[12px_16px] block">
            Services for {addressGroupName}
          </span>
          <div className="grid grid-cols-[1fr_auto] gap-2 px-4 pb-2 text-[11px] text-[var(--color-white-3)] font-medium">
            <span>Service</span>
            <span className="text-right w-[70px]">Client Share</span>
          </div>
        </div>
        <div className="flex flex-col overflow-y-auto">
          {services.map((service, sIndex) => {
            const totalProviderShare =
              service.revShare?.reduce((sum, rev) => sum + rev.share, 0) || 0;
            const supplierShare = service.addSupplierShare
              ? service.supplierShare
              : 0;
            const clientShare = 100 - totalProviderShare - supplierShare - delegatorFee;

            return (
              <div
                key={sIndex}
                className={`grid grid-cols-[1fr_auto] gap-2 items-center px-4 py-2 ${
                  sIndex !== services.length - 1
                    ? 'border-b border-[var(--slate-dividers)]'
                    : ''
                }`}
              >
                <span
                  className="text-[13px] text-[var(--color-white-1)] truncate"
                  title={service.service.name}
                >
                  {service.service.name}
                </span>
                <span className="font-mono text-[13px] text-[var(--color-white-1)] text-right w-[70px]">
                  {clientShare.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
