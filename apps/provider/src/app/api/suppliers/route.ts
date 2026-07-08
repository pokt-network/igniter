import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature, truncateIdentity} from "@/lib/utils/routes";
import {SupplierStakeRequest} from "@/lib/models/supplier";
import {Supplier} from '@igniter/domain/provider/models';
import {APIResponse} from "@/lib/models/response";
import {getSupplierStakeConfigurations} from "@/lib/services/suppliers";
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
