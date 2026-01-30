import { StakeDistributionOffer } from "@/lib/models/StakeDistributionOffer";
import {SupplierStake} from "@/lib/models/Transactions";
import {ApplicationSettings} from "@igniter/db/middleman/schema";

export async function requestSuppliers(selectedAddressGroupId: number, stakeOffer: StakeDistributionOffer, settings: ApplicationSettings, ownerAddress: string, region: string = '', simulate = false): Promise<SupplierStake[]> {
    try {
        const response = await fetch("/api/provider-rpc", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                provider: stakeOffer.identity,
                path: `/api/suppliers?simulate=${simulate ?? false}`,
                data: {
                    region,
                    addressGroupId: selectedAddressGroupId,
                    delegatorAddress: settings.delegatorRewardsAddress,
                    revSharePercentage: Number(settings.fee),
                    items: stakeOffer.stakeDistribution,
                    ownerAddress,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody?.error || "Failed to request keys");
        }

        const { data } = await response.json();
        return data;
    } catch (error) {
        console.error("Failed to request keys:", error);
        throw error;
    }
}

export async function releaseSuppliers(stakeOffer: StakeDistributionOffer, addresses: string[]) {
    try {
        const response = await fetch("/api/provider-rpc", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                provider: stakeOffer.identity,
                path: "/api/suppliers/release",
                data: {
                    addresses,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody?.error || "Failed to request keys");
        }
    } catch (error) {
        console.error("Failed to request keys:", error);
        throw error;
    }
}
