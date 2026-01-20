"use server";

import type { RelayMiner, InsertRelayMiner } from "@igniter/db/provider/schema";
import { list, remove, insert, update } from "@/lib/dal/relayMiners";
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

export async function ListRelayMiners() {
  return withRequireOwnerOrAdmin(async () => {
    return list();
  });
}

export async function DeleteRelayMiner(id: number) {
  return withRequireOwnerOrAdmin(async () => {
    return remove(id);
  });
}

export async function CreateRelayMiner(relayMiner: Omit<InsertRelayMiner, 'createdBy' | 'updatedBy'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    return insert({
      ...relayMiner,
      createdBy: user.identity,
      updatedBy: user.identity,
    });
  });
}

export async function UpdateRelayMiner(id: number, relayMiner: Pick<RelayMiner, 'name' | 'identity' | 'regionId' | 'domain'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    return update(id, {
      ...relayMiner,
      updatedBy: user.identity,
    });
  });
}
