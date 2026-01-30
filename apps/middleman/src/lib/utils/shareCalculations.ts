type AddressGroupService = {
  addSupplierShare: boolean;
  supplierShare: number;
  revShare?: Array<{
    address: string;
    share: number;
  }>;
};

type AddressGroup = {
  addressGroupServices: AddressGroupService[];
};

export interface ShareCalculation {
  providerShare: number;
  supplierShare: number;
  delegatorShare: number;
  clientShare: number;
}

/**
 * Calculates the average share percentages for an address group
 * @param addressGroup The address group with its services
 * @param delegatorFee The delegator fee percentage
 * @returns The calculated shares for client, provider, supplier, and delegator
 */
export function calculateShares(
  addressGroup: AddressGroup,
  delegatorFee: number
): ShareCalculation {
  const services = addressGroup.addressGroupServices || [];

  if (services.length === 0) {
    return {
      providerShare: 0,
      supplierShare: 0,
      delegatorShare: delegatorFee,
      clientShare: 100 - delegatorFee,
    };
  }

  // Calculate average provider share (from revShare)
  const totalProviderShare = services.reduce((sum: number, service: any) => {
    const revShareTotal =
      service.revShare?.reduce((acc: number, rev: any) => acc + rev.share, 0) ||
      0;
    return sum + revShareTotal;
  }, 0);
  const avgProviderShare = totalProviderShare / services.length;

  // Calculate average supplier share (only where addSupplierShare is true)
  const servicesWithSupplierShare = services.filter(
    (s: any) => s.addSupplierShare
  );
  const totalSupplierShare = servicesWithSupplierShare.reduce(
    (sum: number, service: any) => {
      return sum + (service.supplierShare || 0);
    },
    0
  );
  const avgSupplierShare =
    servicesWithSupplierShare.length > 0
      ? totalSupplierShare / servicesWithSupplierShare.length
      : 0;

  const clientShare = 100 - avgProviderShare - avgSupplierShare - delegatorFee;

  return {
    providerShare: avgProviderShare,
    supplierShare: avgSupplierShare,
    delegatorShare: delegatorFee,
    clientShare: Math.max(0, clientShare),
  };
}
