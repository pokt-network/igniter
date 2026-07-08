import {NextResponse} from "next/server";
import {ensureApplicationIsBootstrapped, validateRequestSignature} from "@/lib/utils/routes";
import {APIResponse} from "@/lib/models/response";
import * as schema from "@igniter/db/provider/schema";
import {getDbClient} from "@/db";
import {inArray, eq} from "drizzle-orm";
import { getLogger } from "@igniter/logger";
import { withLogging } from "@/lib/logging/withLogging";

const {keysTable, addressGroupTable} = schema;
const log = getLogger(["provider", "suppliers"]);

type AddressGroupsRequest = {
    addresses: string[]
}

type AddressGroup = {
    id: number
    name: string
    addresses: string[]
}

type AddressGroupsResponse = {
    addressGroups: AddressGroup[]
}

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

export const POST = withLogging(async (request: Request): Promise<NextResponse<APIResponse<AddressGroupsResponse | null>>> => {
    try {
        const isBootstrappedResponse = await ensureApplicationIsBootstrapped();

        if (isBootstrappedResponse instanceof NextResponse) {
            return isBootstrappedResponse;
        }

        const signatureValidationResponse = await validateRequestSignature<AddressGroupsRequest>(request);

        if (signatureValidationResponse instanceof NextResponse) {
            return signatureValidationResponse;
        }

        const {data} = signatureValidationResponse;

        if (!data || !data.addresses || data.addresses.length === 0) {
            return NextResponse.json({error: "Invalid request. Empty addresses list."}, {status: 400});
        }

        const dbClient = getDbClient();

        const rows = await dbClient.db
            .select({
                keyAddress: keysTable.address,
                groupId: addressGroupTable.id,
                groupName: addressGroupTable.name,
            })
            .from(keysTable)
            .innerJoin(addressGroupTable, eq(keysTable.addressGroupId, addressGroupTable.id))
            .where(inArray(keysTable.address, data.addresses));

        const groupsMap = new Map<number, AddressGroup>();

        for (const row of rows) {
            if (!groupsMap.has(row.groupId)) {
                groupsMap.set(row.groupId, {
                    id: row.groupId,
                    name: '',
                    addresses: [],
                });
            }
            groupsMap.get(row.groupId)!.addresses.push(row.keyAddress);
        }

        const addressGroups = Array.from(groupsMap.values());

        return NextResponse.json({data: {addressGroups}}, {status: 200});
    } catch (e) {
        log.error('address groups lookup failed', { error: e });
        return NextResponse.json({error: "Invalid request"}, {status: 500});
    }
})
