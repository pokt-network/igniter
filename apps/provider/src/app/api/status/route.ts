import {NextResponse} from "next/server";
import {getApplicationSettings} from "@/lib/dal/applicationSettings";
import {list} from "@/lib/dal/addressGroups";
import {list as listRegions} from '@/lib/dal/regions';
import {ensureApplicationIsBootstrapped, validateRequestSignature} from "@/lib/utils/routes";
import {StatusRequest, StatusResponse} from "@/lib/models/status";
import type {AddressGroupWithDetails} from "@igniter/db/provider/schema";
import {ProviderFee} from "@igniter/db/provider/enums";
import {getRevShare} from "@igniter/domain/provider/utils";

async function getUniqueRegions(): Promise<string[]> {
  const regions = await listRegions();
  return regions.map((region) => region.displayName);
}

function getUniqueDomains(addressGroups: AddressGroupWithDetails[]) {
  return Array.from(new Set(addressGroups
    .filter((group) => group.relayMiner.domain)
    .map((group) => group.relayMiner.domain!)
  ).values());
}

type AuditKeys = "createdAt" | "updatedAt" | "createdBy" | "updatedBy";

const AUDIT_FIELDS: Record<AuditKeys, true> = {
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
};

export function stripAuditFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripAuditFields) as T;
  }

  if (value && typeof value === "object") {
    const result: any = {};

    for (const key in value) {
      if (AUDIT_FIELDS[key as AuditKeys]) continue;
      result[key] = stripAuditFields((value as any)[key]);
    }

    return result;
  }

  return value;
}

export async function POST(request: Request) {
  try {
    const isBootstrappedResponse = await ensureApplicationIsBootstrapped();

    if (isBootstrappedResponse instanceof NextResponse) {
      return isBootstrappedResponse;
    }

    const signatureValidationResponse = await validateRequestSignature<StatusRequest>(request);

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse;
    }

    const applicationSettings = await getApplicationSettings();
    const addressGroups = await list()
      .then((addressesGroup) => addressesGroup.filter((ag) => !ag.private));

    const minimumStake = applicationSettings.minimumStake;

    const fees = addressGroups.reduce((allFees, group) => {
      const groupFees =
        group.addressGroupServices.map((service) =>
          getRevShare(service, '').map((share) => share.revSharePercentage)
        );

      return [...allFees, ...groupFees.flat()];
    }, [] as number[]);

    const regions = await getUniqueRegions();

    const allowedStakers = Array.from(new Set(addressGroups.flatMap(group => group.linkedAddresses)));

    const response: StatusResponse = {
      regions,
      allowedStakers,
      minimumStake: minimumStake,
      allowPublicStaking: addressGroups && Array.isArray(addressGroups) && addressGroups.some(group => !group.private),
      fee: fees.length > 0 ? Math.max(...fees) : 0,
      feeType: Array.from(new Set(fees)).length === 1 ? ProviderFee.Fixed : ProviderFee.UpTo,
      domains: getUniqueDomains(addressGroups),
      healthy: true,
      addressGroups: addressGroups.map(stripAuditFields),
      rewardAddresses: applicationSettings.rewardAddresses,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Invalid request" }, { status: 500 });
  }
}
