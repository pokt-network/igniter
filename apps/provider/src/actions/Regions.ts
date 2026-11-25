"use server";

import type { Region, InsertRegion } from "@igniter/db/provider/schema";
import { list, remove, insert, update } from "@/lib/dal/regions";
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

export async function ListRegions() {
  return withRequireOwnerOrAdmin(async () => {
    return list();
  });
}

export async function DeleteRegion(id: number) {
  return withRequireOwnerOrAdmin(async () => {
    return remove(id);
  });
}

export async function CreateRegion(region: Omit<InsertRegion, 'createdBy' | 'updatedBy'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    // Explicit fields only: never id/createdBy/updatedBy (or any other column) from input.
    return insert({
      displayName: region.displayName,
      urlValue: region.urlValue,
      createdBy: user.identity,
      updatedBy: user.identity,
    });
  });
}

export async function UpdateRegion(id: number, region: Pick<Region, 'displayName' | 'urlValue'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    return update(id, {
      displayName: region.displayName,
      urlValue: region.urlValue,
      updatedBy: user.identity,
    });
  });
}
