import ProviderIcon from '@/app/assets/icons/dark/providers.svg'
import { StakeDistributionOffer } from '@/lib/models/StakeDistributionOffer'
import { CheckIcon, InfoIcon, CaretIcon } from '@igniter/ui/assets'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import { useState } from 'react'
import { calculateShares } from '@/lib/utils/shareCalculations'
import { ServicesPopover } from '@/app/app/stake/components/ServicesPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@igniter/ui/components/tooltip'

export interface ProviderOfferItemProps {
    offer: StakeDistributionOffer;
    selectedAddressGroupId?: number;
    onSelectAddressGroup?: (offer: StakeDistributionOffer, addressGroupId: number) => void;
    disabled?: boolean;
    delegatorFee: number;
    userIdentity: string;
}

export function ProviderOfferItem({ selectedAddressGroupId, offer, onSelectAddressGroup, disabled, delegatorFee, userIdentity }: Readonly<ProviderOfferItemProps>) {
    const [isExpanded, setIsExpanded] = useState(offer.addressGroups.length === 1)

    // Sort address groups: linked/personal ones first
    const sortedAddressGroups = [...offer.addressGroups].sort((a, b) => {
        const aIsLinked = a.linkedAddresses && a.linkedAddresses.length > 0 && a.linkedAddresses.some((addr: string) => addr.toLowerCase() === userIdentity.toLowerCase())
        const bIsLinked = b.linkedAddresses && b.linkedAddresses.length > 0 && b.linkedAddresses.some((addr: string) => addr.toLowerCase() === userIdentity.toLowerCase())

        if (aIsLinked && !bIsLinked) return -1
        if (!aIsLinked && bIsLinked) return 1
        return 0
    })

    const hasSelection = offer.addressGroups.some(ag => ag.id === selectedAddressGroupId)

    const className = hasSelection
        ? 'relative flex flex-col gradient-border-purple'
        : 'relative flex flex-col rounded-[8px] border-[2px] border-[--black-dividers]'

    return (
        <div className={className}>
            <div className={`flex flex-col m-[0.5px] bg-[var(--background)] rounded-[8px]`}>
                {/* Provider Header */}
                <div
                    className="flex flex-row items-center justify-between p-[20px_25px] cursor-pointer hover:opacity-80"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <span className="flex flex-row items-center gap-5">
                        <span>
                            <ProviderIcon />
                        </span>
                        <span className="flex flex-col gap-2">
                            <span className="flex flex-row items-center gap-2">
                                <span className={`${disabled ? 'text-[var(--color-white-3)]' : ''}`}>{offer.name}</span>
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
                                <span className={`${disabled ? 'text-[var(--color-white-3)]' : ''}`}>
                                    Performance: {offer.rewards}
                                </span>
                                <span className={`${disabled ? 'text-[var(--color-white-3)]' : ''}`}>
                                    Plans: {offer.addressGroups.length}
                                </span>
                            </span>
                        </span>
                    </span>
                    <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        <CaretIcon />
                    </span>
                </div>

                {/* Address Groups (Plans) */}
                {isExpanded && (
                    <div className="flex flex-col border-t border-[var(--black-dividers)]">
                        {sortedAddressGroups.map((addressGroup, index) => {
                            const shares = calculateShares(addressGroup, delegatorFee)
                            const isSelected = addressGroup.id === selectedAddressGroupId
                            const servicesCount = addressGroup.addressGroupServices?.length || 0

                            return (
                                <div
                                    key={addressGroup.id}
                                    className={`flex flex-col p-[16px_25px] overflow-visible ${index !== sortedAddressGroups.length - 1 ? 'border-b border-[var(--black-dividers)]' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--color-slate-2)]'} ${isSelected ? 'bg-[var(--color-slate-2)]' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (!disabled && onSelectAddressGroup) {
                                            onSelectAddressGroup(offer, addressGroup.id)
                                        }
                                    }}
                                >
                                    <div className="flex flex-row items-center justify-between overflow-visible">
                                        <span className="flex flex-row items-center gap-2 overflow-visible">
                                            <span className="font-medium">{addressGroup.name}</span>
                                            {addressGroup.linkedAddresses && addressGroup.linkedAddresses.length > 0 && addressGroup.linkedAddresses.some((addr: string) => addr.toLowerCase() === userIdentity.toLowerCase()) && (
                                                <span className="flex flex-row items-center gap-1.5">
                                                    <Tooltip>
                                                        <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                            <span className="px-2 py-0.5 text-[11px] font-medium bg-purple-500/20 text-purple-300 rounded">
                                                                Personal
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="flex flex-col w-[260px] bg-[var(--color-slate-2)] p-0 border-2 border-[var(--black-dividers)] shadow-[0_8px_16px_rgba(0,0,0,0.4)]">
                                                            <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[12px_16px]">
                                                                Personal Plan
                                                            </span>
                                                            <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
                                                            <span className="text-[13px] text-[var(--color-white-3)] p-[12px_16px]">
                                                                This plan is exclusively available to you based on your selected owner address being linked to this provider's plan. Other users cannot stake to this plan.
                                                            </span>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </span>
                                            )}
                                            <span className="text-[var(--color-white-3)] -ml-2">:</span>
                                            <span className="flex flex-row items-center gap-1.5 text-[14px] mt-0.5">
                                                <span className="text-[var(--color-white-3)]">Client Share:</span>
                                                <span className="font-mono">{shares.clientShare.toFixed(1)}%</span>
                                            </span>
                                        </span>
                                        <div className="flex flex-row items-center gap-3">
                                            <ServicesPopover
                                                addressGroupName={addressGroup.name}
                                                services={addressGroup.addressGroupServices}
                                                servicesCount={servicesCount}
                                                triggerClassName="text-[14px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] underline cursor-pointer"
                                                delegatorFee={delegatorFee}
                                            />
                                            <span className="w-5 h-5 flex items-center justify-center">
                                                {isSelected && <CheckIcon />}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
