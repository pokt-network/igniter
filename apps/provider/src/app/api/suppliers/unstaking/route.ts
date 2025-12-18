import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature} from "@/lib/utils/routes";
import {SupplierMarkStakedRequest} from "@/lib/models/supplier";
import {APIResponse} from "@/lib/models/response";
import { markStakedSupplierAsUnstaking } from '@/lib/services/suppliers'
import {REQUEST_IDENTITY_HEADER} from "@/lib/constants";

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

export async function POST(request: Request): Promise<NextResponse<APIResponse<'OK' | null>>> {
    try {
        console.log('Received a request for unstaking suppliers');
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
        const signatureValidationResponse = await validateRequestSignature<SupplierMarkStakedRequest>(request);

        if (signatureValidationResponse instanceof NextResponse) {
            console.log('Signature validation failed. Exiting.');
            return signatureValidationResponse;
        }

        console.log('Signature validation successful.');
        const {data} = signatureValidationResponse;


        if (!data || !data.addresses.length) {
            console.log('Invalid request. Empty suppliers list.');
            return NextResponse.json({error: "Invalid request. Empty suppliers list."}, {status: 400});
        }

        await markStakedSupplierAsUnstaking(data.addresses, delegatorIdentity);
        return NextResponse.json({ data: 'OK' }, { status: 200 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({error: "Invalid request"}, {status: 500});
    }
}
