import {BuildSupplierServiceConfigInput} from '@igniter/domain/provider/operations';
import {getRevShare, getEndpointInterpolatedUrl} from "@igniter/domain/provider/utils";
import {SupplierServiceConfig} from "@igniter/pocket/proto/pocket/shared/service";
import {RevenueShareOverflowError} from "@igniter/domain/provider/errors";
import {RPCTypeMap} from '@igniter/pocket';

export class BuildSupplierServiceConfigHandler {
    execute(input: BuildSupplierServiceConfigInput) : SupplierServiceConfig[] {
        const {addressGroup, services, requestRevShare, operatorAddress, ownerAddress} = input;

        const svcConfigs = addressGroup.addressGroupServices ?? [];

        return svcConfigs.map(cfg => {
            const svc = services.find(s => s.serviceId === cfg.serviceId)!;

            const revShare = [
                ...getRevShare(cfg, operatorAddress),
                ...requestRevShare,
            ].filter(r => r.revSharePercentage > 0);

            const ownerPct =
                100 - revShare.reduce((sum, r) => sum + r.revSharePercentage, 0);

            if (ownerPct > 0) {
                revShare.push({
                    address: ownerAddress,
                    revSharePercentage: ownerPct,
                });
            }

            const totalRevShare = revShare.reduce((sum, r) => sum + r.revSharePercentage, 0);

            if (totalRevShare > 100) {
                throw new RevenueShareOverflowError(totalRevShare);
            }

            const overrides = cfg.endpointOverrides ?? {};

            return {
                serviceId: cfg.serviceId,
                revShare,
                endpoints: svc.endpoints.map((ep) => {
                    const rpcKey = String(ep.rpcType);
                    const overrideUrl = overrides[rpcKey];

                    return {
                        url: overrideUrl || getEndpointInterpolatedUrl(ep, {
                            sid: svc.serviceId,
                            rm: addressGroup.relayMiner.identity,
                            region: addressGroup.relayMiner.region.urlValue,
                            domain: addressGroup.relayMiner.domain,
                        }),
                        rpcType: RPCTypeMap[ep.rpcType] ?? -1,
                        configs: [],
                    };
                }),
            };
        });
    }
}
