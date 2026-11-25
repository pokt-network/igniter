import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature, truncateIdentity} from "@/lib/utils/routes";
import {MAX_STAKE_DISTRIBUTION_ITEMS, MAX_SUPPLIERS_PER_REQUEST, SupplierStakeRequest} from "@/lib/models/supplier";
import {Supplier} from '@igniter/domain/provider/models';
import {APIResponse} from "@/lib/models/response";
import {getSupplierStakeConfigurations} from "@/lib/services/suppliers";
import {findById as findAddressGroupById} from "@/lib/dal/addressGroups";
import {isAddressGroupOpenTo} from "@/lib/utils/addressGroups";
import {REQUEST_IDENTITY_HEADER} from "@igniter/commons/constants";
import { getLogger } from "@igniter/logger";
import { withLogging } from "@/lib/logging/withLogging";

const log = getLogger(["provider", "suppliers"]);

export async function OPTIONS() {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const POST = withLogging(async (request: Request): Promise<NextResponse<APIResponse<Supplier[] | null>>> => {
  try {
    const isBootstrappedResponse = await ensureApplicationIsBootstrapped();

    if (isBootstrappedResponse instanceof NextResponse) {
      return isBootstrappedResponse;
    }

    const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER);

    if (!delegatorIdentity) {
      return NextResponse.json({error: `Invalid request. Delegator identity was not provided. REQUEST_IDENTITY_HEADER: ${REQUEST_IDENTITY_HEADER} is required.`}, {status: 400});
    }

    const signatureValidationResponse = await validateRequestSignature<SupplierStakeRequest>(request);

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse;
    }

    const {data} = signatureValidationResponse;

    if (!data || !data.items.length) {
      return NextResponse.json({error: "Invalid request. Empty stake distribution."}, {status: 400});
    }

    if (data.items.length > MAX_STAKE_DISTRIBUTION_ITEMS) {
      return NextResponse.json({error: `Invalid request. A stake distribution takes at most ${MAX_STAKE_DISTRIBUTION_ITEMS} items.`}, {status: 400});
    }

    const itemsAreValid = data.items.every((item) =>
      Number.isInteger(item?.qty) && item.qty >= 1 && Number.isFinite(item?.amount) && item.amount > 0
    );

    if (!itemsAreValid) {
      return NextResponse.json({error: "Invalid request. Each item needs a positive integer qty and a positive amount."}, {status: 400});
    }

    const totalSuppliers = data.items.reduce((total, item) => total + item.qty, 0);

    if (totalSuppliers > MAX_SUPPLIERS_PER_REQUEST) {
      return NextResponse.json({error: `Invalid request. A stake distribution takes at most ${MAX_SUPPLIERS_PER_REQUEST} suppliers.`}, {status: 400});
    }

    const addressGroup = Number.isInteger(data.addressGroupId)
      ? await findAddressGroupById(data.addressGroupId)
      : undefined;

    if (!addressGroup || !isAddressGroupOpenTo(addressGroup, data.ownerAddress)) {
      log.info('supplier addresses refused', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity), addressGroupId: data.addressGroupId, reason: 'address group not open to owner' });
      return NextResponse.json({error: "Forbidden. The address group is not available for this owner."}, {status: 403});
    }

    const queryParams = new URL(request.url).searchParams;
    const simulate = queryParams.get('simulate');

    log.info('supplier addresses requested', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity), itemCount: data.items.length, simulate: simulate === 'true' });
    const response = await getSupplierStakeConfigurations(data, delegatorIdentity, simulate === 'true');

    if (!response || response.length === 0) {
      log.warn('no addresses available for stake distribution', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity) });
      return NextResponse.json(
        {error: "No addresses available"},
        {
          status: 400,
          headers: {
            "Access-Control-Allow-Origin": "*",
          }
        }
      );
    }

    log.info('supplier addresses returned', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity), addressCount: response.length });
    return NextResponse.json({
      data: response,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (e) {
    log.error('supplier stake configuration request failed', { error: e });
    return NextResponse.json({error: "Invalid request"}, {status: 500});
  }
})
