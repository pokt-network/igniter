import {
  CompareSupplierServiceConfigInput,
  CompareSupplierServiceConfigResponse
} from '@igniter/domain/provider/operations';
import {
  SupplierServiceConfig,
  ServiceRevenueShare,
  SupplierEndpoint,
  ConfigOption,
} from '@igniter/pocket';
import diff from 'microdiff';
import { deduplicateRevShare } from '@igniter/domain/provider/utils';
import {getLogger, Logger} from "@igniter/logger";


const compareStringField =
  <T>(field: keyof T & string) =>
    (a: T, b: T) => String(a[field]).localeCompare(String(b[field]));

function copyAndSort<T>(src: T[], cmp: (a: T, b: T) => number): T[] {
  return [...src].sort(cmp);
}

export class CompareSupplierServiceConfigHandler {
  private logger: Logger;

  constructor() {
    this.logger = getLogger();
  }

  private canonicalise(
    configs: SupplierServiceConfig[],
  ): SupplierServiceConfig[] {
    return [...configs]
      .sort(compareStringField<SupplierServiceConfig>('serviceId'))
      .map(cfg => ({
        serviceId: cfg.serviceId,

        revShare: copyAndSort<ServiceRevenueShare>(
          deduplicateRevShare(cfg.revShare),
          compareStringField<ServiceRevenueShare>('address'),
        ),

        endpoints: copyAndSort<SupplierEndpoint>(
          cfg.endpoints,
          (e1, e2) =>
            e1.url.localeCompare(e2.url) ||
            e1.rpcType - e2.rpcType,
        ).map(ep => ({
          url: ep.url,
          rpcType: ep.rpcType,
          configs: copyAndSort<ConfigOption>(
            ep.configs ?? [],
            (c1, c2) =>
              c1.key - c2.key ||
              c1.value.localeCompare(c2.value),
          ),
        })),
      }));
  }

  execute(input: CompareSupplierServiceConfigInput): CompareSupplierServiceConfigResponse {
    this.logger.info('CompareSupplierServiceConfigHandler: Execution started');
    const {serviceConfigSetA, serviceConfigSetB} = input;

    const canonicalA = this.canonicalise(serviceConfigSetA);

    this.logger.debug('CompareSupplierServiceConfigHandler: Canonicalised service config set A', { canonicalA });

    const canonicalB = this.canonicalise(serviceConfigSetB);

    this.logger.debug('CompareSupplierServiceConfigHandler: Canonicalized service config set B', { canonicalB });

    if (canonicalA.length !== canonicalB.length) {
      this.logger.info(`CompareSupplierServiceConfigHandler: Execution ended. Service config sets have different lengths: ${ canonicalA.length}, ${canonicalB.length}`);
      return {
        isEqual: false,
        diff: diff(canonicalA, canonicalB),
      }
    }

    const isEqual = (
      JSON.stringify(canonicalA) ===
      JSON.stringify(canonicalB)
    );

    this.logger.info(`CompareSupplierServiceConfigHandler: Execution ended. Service config sets equality resulted: ${isEqual}`);

    return {
      isEqual,
      diff: diff(canonicalA, canonicalB),
    }
  }
}

