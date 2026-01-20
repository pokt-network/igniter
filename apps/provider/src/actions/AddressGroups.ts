"use server";

import type {
    AddressGroup,
    InsertAddressGroup,
    AddressGroupService,
} from "@igniter/db/provider/schema";
import { insert, list, remove, simpleList, update } from '@/lib/dal/addressGroups'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

export async function CreateAddressGroup(
  addressGroup: Omit<InsertAddressGroup, 'createdBy' | 'updatedBy'>,
  services: Omit<AddressGroupService, 'addressGroupId' | 'service'>[]
) {
  return withRequireOwnerOrAdmin(async (user) => {
    return insert(
      {
        ...addressGroup,
        createdBy: user.identity,
        updatedBy: user.identity,
      },
      services,
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
        ...addressGroup,
        updatedBy: user.identity,
      },
      services,
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
