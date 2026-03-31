import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature} from "@/lib/utils/routes";
import {SupplierStakeRequest} from "@/lib/models/supplier";
import {Supplier} from '@igniter/domain/provider/models';
import {APIResponse} from "@/lib/models/response";
import {getSupplierStakeConfigurations} from "@/lib/services/suppliers";
import {REQUEST_IDENTITY_HEADER} from "@igniter/commons/constants";

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

export async function POST(request: Request): Promise<NextResponse<APIResponse<Supplier[] | null>>> {
  try {
    console.log('Received a request for suppliers');
    const isBootstrappedResponse = await ensureApplicationIsBootstrapped();

    if (isBootstrappedResponse instanceof NextResponse) {
      console.log('Application is not bootstrapped. Exiting.');
      return isBootstrappedResponse;
    }

    const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER);

    if (!delegatorIdentity) {
      console.log(`Invalid request. Delegator identity was not provided. REQUEST_IDENTITY_HEADER: ${REQUEST_IDENTITY_HEADER} is required.`);
      return NextResponse.json({error: `Invalid request. Delegator identity was not provided. REQUEST_IDENTITY_HEADER: ${REQUEST_IDENTITY_HEADER} is required.`}, {status: 400});
    }

    console.log('Validating signature...');
    const signatureValidationResponse = await validateRequestSignature<SupplierStakeRequest>(request);

    if (signatureValidationResponse instanceof NextResponse) {
      console.log('Signature validation failed. Exiting.');
      return signatureValidationResponse;
    }

    console.log('Signature validation successful.');
    const {data} = signatureValidationResponse;


    if (!data || !data.items.length) {
      console.log('Invalid request. Empty stake distribution.');
      return NextResponse.json({error: "Invalid request. Empty stake distribution."}, {status: 400});
    }

    const queryParams = new URL(request.url).searchParams;
    const simulate = queryParams.get('simulate');

    console.log('Generating addresses...');
    const response = await getSupplierStakeConfigurations(data, delegatorIdentity, simulate === 'true');

    if (!response || response.length === 0) {
      console.log('No addresses available');
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

    console.log('Returning addresses');
    return NextResponse.json({
      data: response,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({error: "Invalid request"}, {status: 500});
  }
}
