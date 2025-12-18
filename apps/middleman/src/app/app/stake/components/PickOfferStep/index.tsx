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

export interface PickOfferStepProps {
    amount: number;
    ownerAddress: string;
    defaultOffer?: StakeDistributionOffer;
    onOfferSelected: (offer: StakeDistributionOffer) => void;
    onBack: () => void;
    onClose: () => void;
}

export function PickOfferStep({onOfferSelected, amount, ownerAddress, onBack, defaultOffer, onClose}: Readonly<PickOfferStepProps>) {
    const [selectedOffer, setSelectedOffer] = useState<StakeDistributionOffer | undefined>(defaultOffer);
    const [isShowingUnavailable, setIsShowingUnavailable] = useState<boolean>(false);
    const [offers, setOffers] = useState<StakeDistributionOffer[]>([]);
    const [isLoadingOffers, setIsLoadingOffers] = useState<boolean>(false);

    {/* TODO: Calculate the amount based on POKT. Using the function provided by currency context. Show the currency from the context. */}
    const subtitle = `Pick a node runner for your ${toCurrencyFormat(amount)} $POKT stake.`;

    const availableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length > 0);
    }, [offers]);

    const unavailableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length === 0);
    }, [offers]);

    const hasUnavailableOffers = useMemo(() => {
        return unavailableOffers.length > 0;
    }, [unavailableOffers])

    const selectableOffers = useMemo(() => {
        return offers.filter((offer) => offer.stakeDistribution.length > 0);
    }, [offers]);

    useEffect(() => {
        if (!selectedOffer && selectableOffers.length) {
            setSelectedOffer(offers[0]);
        }
    }, [offers, selectedOffer]);

    useEffect(() => {
        (async () => {
            setIsLoadingOffers(true);
            try {
                const calculatedOffers = await CalculateStakeDistribution(amount, ownerAddress);
                setOffers(calculatedOffers);
                if (selectedOffer) {
                    const updatedSelectedOffer = calculatedOffers.find((offer) => offer.id === selectedOffer.id && offer.stakeDistribution.length > 0);;
                    setSelectedOffer(updatedSelectedOffer);
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
            className="flex flex-col w-[480px] border-x border-b border-[--balck-deviders] p-[33px] rounded-b-[12px] gap-8">
            <ActivityHeader
                onClose={onClose}
                onBack={onBack}
                title="Provider"
                subtitle={subtitle}
            />

            {isLoadingOffers && (
              <ActivityContentLoading />
            )}

            <div className="flex flex-col gap-3">
                {availableOffers.map((offer) => (
                    <ProviderOfferItem
                        key={offer.id}
                        offer={offer}
                        isSelected={selectedOffer?.id === offer.id}
                        onSelect={() => setSelectedOffer(offer)}
                    />
                ))}
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
                <div className="-mb-4.5 p-[11px_16px] bg-[var(--color-slate-2)] rounded-[8px]">
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Some providers are ineligible for the selected stake amount.
                    </span>
                </div>
            )}

            {hasUnavailableOffers && isShowingUnavailable && (
                <div className="flex flex-col gap-3">
                    {unavailableOffers.map((offer) => (
                        <ProviderOfferItem
                            key={offer.id}
                            offer={offer}
                            disabled={true}
                        />
                    ))}
                </div>
            )}

            <Button
                className="w-full h-[40px]"
                disabled={!selectedOffer}
                onClick={() => onOfferSelected(selectedOffer!)}
            >
                Continue
            </Button>
        </div>
    );
}
