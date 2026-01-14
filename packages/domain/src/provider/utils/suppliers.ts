import {SupplierEndpointInterpolationParams} from "@igniter/domain/provider/models";
import {Supplier, ServiceConfigUpdate} from "@igniter/pocket/proto/pocket/shared/supplier";
import {RPCType, SupplierEndpoint, SupplierServiceConfig} from '@igniter/pocket/proto/pocket/shared/service'
import {PROTOCOL_DEFAULT_URL} from "@igniter/domain/provider/constants";
import {KeyWithGroup} from "@igniter/db/provider/schema";

export function getSchemeForRpcType(rpcType: RPCType) {
    switch (rpcType) {
        case RPCType.JSON_RPC:
        case RPCType.REST:
            return 'https';
        case RPCType.GRPC:
            return 'grpcs';
        case RPCType.WEBSOCKET:
            return 'wss';
        default:
            return 'https';
    }
}

export function getUrlTokenFromRpcType(rpcType: RPCType) {
    switch (rpcType) {
        case RPCType.JSON_RPC:
            return 'json';
        case RPCType.REST:
            return 'rest';
        case RPCType.GRPC:
            return 'grpc';
        case RPCType.WEBSOCKET:
            return 'ws';
        default:
            return 'json';
    }
}

export function getDefaultUrlWithSchemeByRpcType(rpcType: RPCType) {
    return PROTOCOL_DEFAULT_URL.replace('{scheme}', getSchemeForRpcType(rpcType));
}

export function getEndpointInterpolatedUrl(endpoint: Pick<SupplierEndpoint, 'rpcType' | 'url'>, params: SupplierEndpointInterpolationParams) {
    const protocol = getUrlTokenFromRpcType(endpoint.rpcType!);
    const url = endpoint.url || getDefaultUrlWithSchemeByRpcType(endpoint.rpcType!);

    const data: Record<string, string> = {
        ...params,
        protocol,
    };

    return url.replace(/{(\w+)}/g, (_match: string, key: string) => {
        return data[key] || `{${key}}`;
    });
}

/**
 * Returns the **unique** list of serviceIds that are considered “active”
 * for a supplier at a given block height.
 *
 * Rules
 * -----
 * 1.  Include every service currently active (`supplier.services`),
 *     **unless** there is an entry in `serviceConfigHistory`
 *     whose `service.serviceId` matches **and** `deactivationHeight` is
 *     greater than the provided `currentHeight`
 *     (i.e., the service is scheduled to be removed).
 *
 * 2.  Include every service that is scheduled to become active
 *     (`activationHeight` > `currentHeight`) and **not** already scheduled
 *     for removal before it becomes active.
 *
 * 3.  The returned list contains each `serviceId` only once.
 *
 * @param supplier      Full supplier object returned from the chain.
 * @param currentHeight Current block height you are evaluating against.
 */
export function getSupplierActiveServices(
  supplier: Supplier,
  currentHeight: number,
): SupplierServiceConfig[] {
  const result = new Set<SupplierServiceConfig>()

  const scheduledDeactivations = new Set<string>()
  supplier.serviceConfigHistory.forEach((h: ServiceConfigUpdate) => {
    if (h.deactivationHeight > currentHeight && h.service?.serviceId) {
      scheduledDeactivations.add(h.service.serviceId)
    }
  })


  supplier.services.forEach((s: SupplierServiceConfig) => {
    if (!scheduledDeactivations.has(s.serviceId)) result.add(s)
  })


  supplier.serviceConfigHistory.forEach((h: ServiceConfigUpdate) => {
    const id = h.service?.serviceId
    const willActivate = h.activationHeight > currentHeight
    const removedBeforeActivation =
      h.deactivationHeight !== 0 && h.deactivationHeight <= currentHeight

    if (willActivate && !removedBeforeActivation) {
      if (h.service) {
        result.add(h.service)
      }
    }
  })

  return [...result]
}

/**
 * Builds the expected SupplierServiceConfig array from a KeyWithGroup.
 * This represents the services that should be configured for a supplier
 * based on their address group configuration.
 *
 * @param key - The key with its associated address group details
 * @returns Array of expected SupplierServiceConfig
 */
export function getExpectedServicesFromKey(key: KeyWithGroup): Array<SupplierServiceConfig> {
  const expectedServices: Array<SupplierServiceConfig> = []

  for (const addressGroupService of key?.addressGroup?.addressGroupServices || []) {
    let revShareSum = 0

    const revShare: SupplierServiceConfig['revShare'] = []

    if (key.delegatorRewardsAddress) {
      revShareSum += key.delegatorRevSharePercentage ?? 0

      revShare.push({
        address: key.delegatorRewardsAddress,
        revSharePercentage: key.delegatorRevSharePercentage ?? 0,
      })
    }

    if (addressGroupService.addSupplierShare) {
      revShareSum += addressGroupService.supplierShare ?? 0

      revShare.push({
        address: key.address,
        revSharePercentage: addressGroupService.supplierShare ?? 0,
      })
    }

    for (const revShareElement of addressGroupService.revShare) {
      revShareSum += revShareElement.share

      revShare.push({
        address: revShareElement.address,
        revSharePercentage: revShareElement.share,
      })
    }

    if (revShareSum < 100 && key.ownerAddress) {
      revShare.push({
        address: key.ownerAddress,
        revSharePercentage: 100 - revShareSum,
      })
    }

    const newExpectedService: SupplierServiceConfig = {
      serviceId: addressGroupService.serviceId,
      endpoints: addressGroupService.service.endpoints?.map((endpoint) => ({
        url: getEndpointInterpolatedUrl(endpoint, {
          sid: addressGroupService.serviceId,
          rm: key.addressGroup?.relayMiner?.identity || '',
          region: key.addressGroup?.relayMiner?.region?.urlValue || '',
          domain: key.addressGroup?.relayMiner?.domain || '',
        }),
        rpcType: endpoint.rpcType,
        configs: []
      })),
      revShare,
    }

    expectedServices.push(newExpectedService)
  }

  return expectedServices
}
