import ProviderIcon from '@/app/assets/icons/dark/providers.svg'
import { StakeDistributionOffer } from '@/lib/models/StakeDistributionOffer'
import { CheckIcon, InfoIcon, CaretIcon } from '@igniter/ui/assets'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import millify from 'millify'
import { useState } from 'react'
import { calculateShares, calculateAddressGroupPerformance, calculateEffectiveYield, formatPerformance } from '@/lib/utils/shareCalculations'
import { ServicesPopover } from '@/app/app/stake/components/ServicesPopover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@igniter/ui/components/tooltip'

export interface ProviderOfferItemProps {
    offer: StakeDistributionOffer;
    selectedAddressGroupId?: number;
    onSelectAddressGroup?: (offer: StakeDistributionOffer, addressGroupId: number) => void;
    disabled?: boolean;
    delegatorFee: number;
    userIdentity: string;
    minimumStake: number;
}

export function ProviderOfferItem({ selectedAddressGroupId, offer, onSelectAddressGroup, disabled, delegatorFee, userIdentity, minimumStake }: Readonly<ProviderOfferItemProps>) {
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
        : 'relative flex flex-col rounded-[8px] border-[2px] border-border-primary'

    return (
        <div className={className}>
            <div className={`flex flex-col m-[0.5px] bg-[var(--background)] rounded-[8px] overflow-hidden`}>
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
                                <span className={`${disabled ? 'text-[var(--text-tertiary)]' : ''}`}>{offer.name}</span>
                                <Popover>
                                    <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                                        <InfoIcon />
                                    </PopoverTrigger>
                                    <PopoverContent className="flex flex-col w-[360px] bg-[var(--bg-surface)] p-0 max-h-[500px] overflow-y-auto">
                                        <span className="text-[14px] font-medium text-[var(--text-primary)] p-[12px_16px] sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                                            About these metrics
                                        </span>
                                        <div className="flex flex-col gap-4 p-[12px_16px]">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-[var(--text-primary)]">Est. Yield</span>
                                                <span className="text-[13px] text-[var(--text-tertiary)]">
                                                    Your estimated earnings per supplier per day, calculated as: Performance × Client Share.
                                                    This is the net amount you would receive after all fees are applied.
                                                </span>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-[var(--text-primary)]">Client Share</span>
                                                <span className="text-[13px] text-[var(--text-tertiary)]">
                                                    The median share of rewards you will receive across all services in this plan.
                                                    Calculated per service as: 100% − Provider Share − Supplier Share − Delegator Fee, then the median is taken.
                                                </span>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-[var(--text-primary)]">APR</span>
                                                <span className="text-[13px] text-[var(--text-tertiary)]">
                                                    Annual Percentage Rate, estimated from recent performance.
                                                    Calculated as: (Est. Yield POKT/supplier/day × 365 ÷ minimum stake) × 100.
                                                </span>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </span>
                            <span className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
                                <span className="whitespace-nowrap text-[var(--text-tertiary)]">Plans: <span className={disabled ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}>{offer.addressGroups.length}</span></span>
                                {offer.supplierStats && (
                                    <>
                                        <span className="whitespace-nowrap text-[var(--text-tertiary)]">Suppliers: <span className={disabled ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}>{offer.supplierStats.suppliers_count.toLocaleString()}</span></span>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="whitespace-nowrap text-[var(--text-tertiary)]">Total Staked: <span className={disabled ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}>{millify(offer.supplierStats.total_staked_tokens / 1e6, { precision: 1 })} POKT</span></span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                {(offer.supplierStats.total_staked_tokens / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} POKT
                                            </TooltipContent>
                                        </Tooltip>
                                    </>
                                )}
                            </span>
                        </span>
                    </span>
                    <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        <CaretIcon />
                    </span>
                </div>

                {/* Address Groups (Plans) */}
                {isExpanded && (
                    <div className="flex flex-col border-t border-[var(--border-primary)]">
                        {sortedAddressGroups.map((addressGroup, index) => {
                            const shares = calculateShares(addressGroup, delegatorFee)
                            const isSelected = addressGroup.id === selectedAddressGroupId
                            const planPerformance = calculateAddressGroupPerformance(addressGroup)
                            const effectiveYield = calculateEffectiveYield(planPerformance, shares.clientShare)
                            const apr = effectiveYield !== null && minimumStake > 0
                                ? (effectiveYield * 365 / minimumStake) * 100
                                : null

                            return (
                                <div
                                    key={addressGroup.id}
                                    className={`flex flex-col gap-1 p-[16px_25px] overflow-visible ${index !== sortedAddressGroups.length - 1 ? 'border-b border-[var(--border-primary)]' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--bg-surface)]'} ${isSelected ? 'bg-[var(--bg-surface)]' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (!disabled && onSelectAddressGroup) {
                                            onSelectAddressGroup(offer, addressGroup.id)
                                        }
                                    }}
                                >
                                    {/* Top row: plan name + actions */}
                                    <div className="flex flex-row items-center justify-between overflow-visible">
                                        <span className="flex flex-row items-center gap-2 overflow-visible">
                                            <span className="font-medium">Plan #{index + 1}: {addressGroup.name}</span>
                                            {addressGroup.linkedAddresses && addressGroup.linkedAddresses.length > 0 && addressGroup.linkedAddresses.some((addr: string) => addr.toLowerCase() === userIdentity.toLowerCase()) && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                        <span className="px-2 py-0.5 text-[11px] font-medium bg-[color:var(--pnf-lavender)]/20 text-pnf-lavender rounded">
                                                            Personal
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="flex flex-col w-[260px] bg-[var(--bg-surface)] p-0 border-2 border-[var(--border-primary)] shadow-[0_8px_16px_rgba(0,0,0,0.4)]">
                                                        <span className="text-[14px] font-medium text-[var(--text-primary)] p-[12px_16px]">
                                                            Personal Plan
                                                        </span>
                                                        <div className="h-[1px] bg-[var(--border-subtle)]"></div>
                                                        <span className="text-[13px] text-[var(--text-tertiary)] p-[12px_16px]">
                                                            This plan is exclusively available to you based on your selected owner address being linked to this provider's plan. Other users cannot stake to this plan.
                                                        </span>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </span>
                                        <span className="w-5 h-5 flex items-center justify-center shrink-0">
                                            {isSelected && <CheckIcon />}
                                        </span>
                                    </div>
                                    {/* Metrics row */}
                                    <div className="flex flex-row gap-6 mt-1">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-[var(--text-tertiary)]">Est. Yield</span>
                                            <span className="font-mono text-[13px]">{effectiveYield !== null ? formatPerformance(effectiveYield) : '—'}</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-[var(--text-tertiary)]">Client Share</span>
                                            <span className="font-mono text-[13px]">{shares.clientShare.toFixed(1)}%</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[11px] text-[var(--text-tertiary)]">APR</span>
                                            <span className="font-mono text-[13px]">{apr !== null ? `${apr.toFixed(1)}%` : '—'}</span>
                                        </div>
                                    </div>
                                    {/* Services row */}
                                    <ServicesPopover
                                        addressGroupName={addressGroup.name}
                                        services={addressGroup.addressGroupServices}
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
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
