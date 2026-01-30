'use client';

import {useEffect, useMemo, useState} from "react";
import {Button} from "@igniter/ui/components/button";
import {ActivityHeader} from "@igniter/ui/components/ActivityHeader";
import {StakeDistributionOffer} from "@/lib/models/StakeDistributionOffer";
import {toCurrencyFormat} from "@igniter/ui/lib/utils";
import {ProviderOfferItem} from "@/app/app/stake/components/PickOfferStep/ProviderOfferItem";
import {CaretIcon} from "@igniter/ui/assets";
import {CalculateStakeDistribution} from "@/actions/Stake";
import {ActivityContentLoading} from "@/app/app/stake/components/ActivityContentLoading";
import {getApplicationSettings} from "@/actions/ApplicationSettings";
import {ProviderStatus} from "@igniter/db/middleman/enums";

export interface PickOfferStepProps {
    amount: number;
    ownerAddress: string;
    defaultOffer?: StakeDistributionOffer;
    defaultAddressGroupId?: number;
    preselectedProviderId?: number;
    preselectedAddressGroupId?: number;
    onOfferSelected: (offer: StakeDistributionOffer, addressGroupId: number) => void;
    onBack: () => void;
    onClose: () => void;
}

export function PickOfferStep({onOfferSelected, amount, ownerAddress, onBack, defaultOffer, defaultAddressGroupId, preselectedProviderId, preselectedAddressGroupId, onClose}: Readonly<PickOfferStepProps>) {
    const [selectedOffer, setSelectedOffer] = useState<StakeDistributionOffer | undefined>(defaultOffer);
    const [selectedAddressGroupId, setSelectedAddressGroupId] = useState<number | undefined>(defaultAddressGroupId);
    const [hasAppliedPreselection, setHasAppliedPreselection] = useState(false);
    const [isShowingUnavailable, setIsShowingUnavailable] = useState<boolean>(false);
    const [offers, setOffers] = useState<StakeDistributionOffer[]>([]);
    const [isLoadingOffers, setIsLoadingOffers] = useState<boolean>(false);
    const [delegatorFee, setDelegatorFee] = useState<number>(0);

    {/* TODO: Calculate the amount based on POKT. Using the function provided by currency context. Show the currency from the context. */}
    const subtitle = `Pick a node runner for your ${toCurrencyFormat(amount)} $POKT stake.`;

    const availableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length > 0 && offer.status === ProviderStatus.Healthy);
    }, [offers]);

    const unavailableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length === 0 || offer.status !== ProviderStatus.Healthy);
    }, [offers]);

    const hasUnavailableOffers = useMemo(() => {
        return unavailableOffers.length > 0;
    }, [unavailableOffers])

    const selectableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length > 0 && offer.status === ProviderStatus.Healthy);
    }, [offers]);

    const handleAddressGroupSelection = (offer: StakeDistributionOffer, addressGroupId: number) => {
        setSelectedOffer(offer);
        setSelectedAddressGroupId(addressGroupId);
    };

    useEffect(() => {
        if (!selectedOffer && !selectedAddressGroupId && selectableOffers.length > 0) {
            // Count total address groups across all providers
            const totalAddressGroups = selectableOffers.reduce(
                (total, offer) => total + offer.addressGroups.length,
                0
            );

            // Only auto-select if there's exactly one address group across all providers
            if (totalAddressGroups === 1) {
                const firstOffer = selectableOffers[0];
                const firstAddressGroup = firstOffer?.addressGroups[0];
                if (firstOffer && firstAddressGroup) {
                    setSelectedOffer(firstOffer);
                    setSelectedAddressGroupId(firstAddressGroup.id);
                }
            }
        }
    }, [selectableOffers, selectedOffer, selectedAddressGroupId]);

    useEffect(() => {
        (async () => {
            setIsLoadingOffers(true);
            try {
                const [calculatedOffers, appSettings] = await Promise.all([
                    CalculateStakeDistribution(amount, ownerAddress),
                    getApplicationSettings(),
                ]);

                if (preselectedAddressGroupId && preselectedProviderId) {
                    const preselectedOffer = calculatedOffers.find(
                      (offer) => offer.id === preselectedProviderId &&
                        offer.stakeDistribution.length > 0 &&
                        offer.status === ProviderStatus.Healthy
                    );
                    if (preselectedOffer) {
                        const addressGroupExists = preselectedOffer.addressGroups.some(
                          ag => ag.id === preselectedAddressGroupId
                        );
                        if (addressGroupExists) {
                            onOfferSelected(preselectedOffer, preselectedAddressGroupId)
                            return
                        }
                    }
                }

                setOffers(calculatedOffers);
                setDelegatorFee(appSettings.fee ? Number(appSettings.fee) : 0);

                // Handle preselection from URL params (only on first load)
                // Only preselect if the provider is healthy
                if (!hasAppliedPreselection && preselectedProviderId && preselectedAddressGroupId) {
                    const preselectedOffer = calculatedOffers.find(
                        (offer) => offer.id === preselectedProviderId &&
                                   offer.stakeDistribution.length > 0 &&
                                   offer.status === ProviderStatus.Healthy
                    );
                    if (preselectedOffer) {
                        const addressGroupExists = preselectedOffer.addressGroups.some(
                            ag => ag.id === preselectedAddressGroupId
                        );
                        if (addressGroupExists) {
                            setSelectedOffer(preselectedOffer);
                            setSelectedAddressGroupId(preselectedAddressGroupId);
                        }
                    }
                    setHasAppliedPreselection(true);
                } else if (selectedOffer && selectedAddressGroupId) {
                    const updatedSelectedOffer = calculatedOffers.find((offer) => offer.id === selectedOffer.id && offer.stakeDistribution.length > 0);
                    setSelectedOffer(updatedSelectedOffer);

                    // Check if the selected address group still exists
                    if (updatedSelectedOffer) {
                        const addressGroupExists = updatedSelectedOffer.addressGroups.some(ag => ag.id === selectedAddressGroupId);
                        if (!addressGroupExists) {
                            setSelectedAddressGroupId(undefined);
                        }
                    }
                }
            } catch (error) {
                console.warn('An error occurred while calculating the stake distribution!');
                console.error(error);
            } finally {
                setIsLoadingOffers(false);
            }
        })();
    }, []);

    return (
        <div
            className="flex flex-col w-[580px] border-x border-b border-[--balck-deviders] p-[33px] rounded-b-[12px] gap-8">
            <ActivityHeader
                onClose={onClose}
                onBack={onBack}
                title="Provider"
                subtitle={subtitle}
            />

            {isLoadingOffers && (
              <ActivityContentLoading />
            )}

            {!isLoadingOffers && offers.length === 0 && (
                <div className="flex items-center justify-center pt-12 pb-6">
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        No providers available at this time.
                    </span>
                </div>
            )}

            <div className="flex flex-col gap-3">
                {availableOffers.map((offer) => (
                    <ProviderOfferItem
                        key={offer.id}
                        offer={offer}
                        selectedAddressGroupId={selectedOffer?.id === offer.id ? selectedAddressGroupId : undefined}
                        onSelectAddressGroup={handleAddressGroupSelection}
                        delegatorFee={delegatorFee}
                        userIdentity={ownerAddress}
                    />
                ))}

                {hasUnavailableOffers && (
                  <div className="-mb-2 p-[11px_16px] bg-[var(--color-slate-2)] rounded-[8px]">
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Some providers are ineligible for the selected stake amount or are currently unavailable.
                    </span>
                  </div>
                )}
            </div>

            {hasUnavailableOffers && !isShowingUnavailable && (
                <span className="flex flex-row items-center gap-3 hover:cursor-pointer" onClick={() => setIsShowingUnavailable(true)}>
                    <CaretIcon />
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Not Available
                    </span>
                </span>
            )}

            {hasUnavailableOffers && isShowingUnavailable && (
                <span className="flex flex-row items-center gap-3 hover:cursor-pointer" onClick={() => setIsShowingUnavailable(false)}>
                    <CaretIcon className="transform rotate-90" />
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Not Available
                    </span>
                </span>
            )}

            {hasUnavailableOffers && isShowingUnavailable && (
                <div className="flex flex-col gap-3">
                    {unavailableOffers.map((offer) => (
                        <ProviderOfferItem
                            key={offer.id}
                            offer={offer}
                            disabled={true}
                            delegatorFee={delegatorFee}
                            userIdentity={ownerAddress}
                        />
                    ))}
                </div>
            )}

            <Button
                className="w-full h-[40px]"
                disabled={!selectedOffer || !selectedAddressGroupId}
                onClick={() => onOfferSelected(selectedOffer!, selectedAddressGroupId!)}
            >
                Continue
            </Button>
        </div>
    );
}
