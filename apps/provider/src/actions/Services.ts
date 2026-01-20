"use server";

import type {InsertService, Service} from "@igniter/db/provider/schema";
import {insert, list, remove, update} from "@/lib/dal/services";
import { validRpcTypes } from '@/lib/constants'
import { withRequireOwnerOrAdmin } from '@/lib/utils/actionUtils'

export async function CreateService(service: Omit<InsertService, 'createdBy' | 'updatedBy'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    for (const endpoint of service.endpoints) {
      if (!validRpcTypes.includes(endpoint.rpcType)) {
        throw new Error(`Invalid RPC type: ${endpoint.rpcType}`);
      }
    }

    return insert({
      ...service,
      createdBy: user.identity,
      updatedBy: user.identity,
    });
  });
}

export async function UpdateService(id: string, service: Pick<Service, 'revSharePercentage' | 'endpoints'>) {
  return withRequireOwnerOrAdmin(async (user) => {
    for (const endpoint of service.endpoints) {
      if (!validRpcTypes.includes(endpoint.rpcType)) {
        throw new Error(`Invalid RPC type: ${endpoint.rpcType}`);
      }
    }

    return update(id, {
      ...service,
      updatedBy: user.identity,
    });
  });
}

export async function GetByServiceId(id: string) {
  return withRequireOwnerOrAdmin(async () => {
    const [service] = await list([id]);
    return service;
  });
}

export async function ListServices() {
  return withRequireOwnerOrAdmin(async () => {
    return list();
  });
}

export async function DeleteService(id: string) {
  return withRequireOwnerOrAdmin(async () => {
    return remove(id);
  });
}
