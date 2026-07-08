import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature} from "@/lib/utils/routes";
import {SupplierReleaseRequest} from "@/lib/models/supplier";
import {APIResponse} from "@/lib/models/response";
import {releaseDeliveredSuppliers} from "@/lib/services/suppliers";
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

export const POST = withLogging(async (request: Request): Promise<NextResponse<APIResponse<'OK' | null>>> => {
    try {
        const isBootstrappedResponse = await ensureApplicationIsBootstrapped();

        if (isBootstrappedResponse instanceof NextResponse) {
            return isBootstrappedResponse;
        }

        const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER);

        if (!delegatorIdentity) {
            return NextResponse.json({error: `Invalid request. Delegator identity was not provided. REQUEST_IDENTITY_HEADER: ${REQUEST_IDENTITY_HEADER} is required.`}, {status: 400});
        }

        const signatureValidationResponse = await validateRequestSignature<SupplierReleaseRequest>(request);

        if (signatureValidationResponse instanceof NextResponse) {
            return signatureValidationResponse;
        }

        const {data} = signatureValidationResponse;

        if (!data || !data.addresses.length) {
            return NextResponse.json({error: "Invalid request. Empty suppliers list."}, {status: 400});
        }

        log.info('supplier release requested', { supplierAddresses: data.addresses, delegatorIdentity });
        await releaseDeliveredSuppliers(data.addresses, delegatorIdentity);
        return NextResponse.json({ data: 'OK' }, { status: 200 });
    } catch (e) {
        log.error('supplier release request failed', { error: e });
        return NextResponse.json({error: "Invalid request"}, {status: 500});
    }
})
