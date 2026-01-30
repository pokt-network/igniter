import {ProviderFee, ProviderStatus} from "@igniter/db/middleman/enums";

type AddressGroup = {
  id: number;
  name: string;
  linkedAddresses: string[];
  private: boolean;
  relayMinerId: number;
  keysCount: number;
  relayMiner: {
    id: number;
    name: string;
    identity: string;
    regionId: number;
    domain: string;
    region: {
      id: number;
      displayName: string;
      urlValue: string;
    };
  };
  addressGroupServices: Array<{
    addressGroupId: number;
    serviceId: string;
    addSupplierShare: boolean;
    supplierShare: number;
    revShare: Array<{
      address: string;
      share: number;
    }>;
    service: {
      name: string;
    };
  }>;
};

export interface StakeDistributionOffer {
    id: number;
    identity: string;
    fee: number;
    feeType: ProviderFee;
    name: string;
    rewards: string;
    regions: string[];
    operationalFundsAmount: number;
    status: ProviderStatus;
    stakeDistribution: StakeDistributionItem[];
    addressGroups: AddressGroup[];
}

export interface StakeDistributionItem {
    amount: number;
    qty: number;
}
