"use server";

import type {
    AddressGroup,
    InsertAddressGroup,
    AddressGroupService,
} from "@igniter/db/provider/schema";
import { insert, list, remove, simpleList, update } from '@/lib/dal/addressGroups'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

type GroupServiceInput = Omit<AddressGroupService, 'addressGroupId' | 'service'>

// Copies only the address-group-service columns the DAL writes; drops anything else.
function pickGroupServices(services: GroupServiceInput[]): GroupServiceInput[] {
  return services.map((s) => ({
    serviceId: s.serviceId,
    addSupplierShare: s.addSupplierShare,
    supplierShare: s.supplierShare,
    revShare: s.revShare,
    endpointOverrides: s.endpointOverrides,
  }))
}

export async function CreateAddressGroup(
  addressGroup: Omit<InsertAddressGroup, 'createdBy' | 'updatedBy'>,
  services: Omit<AddressGroupService, 'addressGroupId' | 'service'>[]
) {
  return withRequireOwnerOrAdmin(async (user) => {
    // Explicit fields only: never id/createdBy/updatedBy (or any other column) from input.
    return insert(
      {
        name: addressGroup.name,
        linkedAddresses: addressGroup.linkedAddresses,
        private: addressGroup.private,
        relayMinerId: addressGroup.relayMinerId,
        createdBy: user.identity,
        updatedBy: user.identity,
      },
      pickGroupServices(services),
    );
  });
}

export async function UpdateAddressGroup(
  id: number,
  addressGroup: Pick<AddressGroup, 'name' | 'linkedAddresses' | 'private' | 'relayMinerId'>,
  services: Omit<AddressGroupService, 'addressGroupId' | 'service'>[]
) {
  return withRequireOwnerOrAdmin(async (user) => {
    return update(
      id,
      {
        name: addressGroup.name,
        linkedAddresses: addressGroup.linkedAddresses,
        private: addressGroup.private,
        relayMinerId: addressGroup.relayMinerId,
        updatedBy: user.identity,
      },
      pickGroupServices(services),
    );
  });
}

export async function ListAddressGroups() {
  return withRequireOwnerOrAdmin(async () => {
    return list();
  });
}

export async function ListBasicAddressGroups() {
  return withRequireOwnerOrAdmin(async () => {
    return simpleList();
  });
}

export async function DeleteAddressGroup(id: number) {
  return withRequireOwnerOrAdmin(async () => {
    return remove(id);
  });
}
