import { NextResponse } from "next/server";
import { getApplicationSettings } from "@/lib/dal/applicationSettings";
import { getDelegatorByIdentity } from "@/lib/dal/delegators";
import { verifySignature } from "@igniter/commons/crypto";
import {REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER} from "@igniter/commons/constants";
import {APIResponse} from "@/lib/models/response";

export interface SignedRequestPayload<TData> {
  delegator: ReturnType<typeof getDelegatorByIdentity> extends Promise<infer T> ? T : unknown;
  data: TData;
}


/**
 * Ensures the application is properly bootstrapped before handling any requests.
 * Checks the application settings to determine whether bootstrapping is completed.
 * If not bootstrapped, it returns a 403 JSON response indicating the application is not ready.
 *
 * @return {Promise<void | NextResponse>} Resolves to void if the application is bootstrapped,
 * or a NextResponse object with a 403 status if it is not.
 */
export async function ensureApplicationIsBootstrapped(): Promise<void | NextResponse<APIResponse>> {
  const { isBootstrapped } = await getApplicationSettings();

  if (!isBootstrapped) {
    return NextResponse.json(
      { error: "Forbidden. Application is not ready for requests." },
      { status: 403 }
    );
  }

  return void 0;
}

/**
 * Validates the incoming request according to the common selection rules:
 * - Application is bootstrapped
 * - Request contains a valid X-Middleman-Identity header
 * - The delegator is allowed
 * - The request JSON payload can be parsed and its signature is valid
 *
 * If something is wrong, this function returns an error response;
 * otherwise it returns the allowed delegator and the parsed JSON data.
 */
export async function validateRequestSignature<TData>(request: Request): Promise<SignedRequestPayload<TData> | NextResponse<APIResponse>> {
  console.log('Validating request signature...');
  const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER);
  console.log(`X-Middleman-Identity header: ${delegatorIdentity}`);

  if (!delegatorIdentity) {
    console.log(`Invalid request. X-Middleman-Identity header was not provided.`);
    return NextResponse.json(
      { error: "Invalid request. X-Middleman-Identity header was not provided." },
      { status: 400 }
    );
  }

  console.log('Authenticating delegator...');

  const delegator = await getDelegatorByIdentity(delegatorIdentity);

  if (!delegator) {
    console.log('Delegator not found.');
    return NextResponse.json(
      { error: "Forbidden. The client is not allowed." },
      { status: 403 }
    );
  }

  console.log(`Delegator authenticated. Name: "${delegator?.name}"`);


  let data: TData;

  console.log('Authenticating request signature...');

  try {
    console.log('Extracting payload from request...');
    data = await request.json();
    console.log('Payload extracted successfully');
  } catch (err) {
    console.error('Failed to extract payload from request.');
    console.error(err);
    return NextResponse.json(
      { error: "Invalid request. Is the request valid JSON?" },
      { status: 400 }
    );
  }

  console.log('Parsing payload and verifying signature...');
  const rawData = JSON.stringify(data);
  console.log('Payload parsed successfully.');
  const providedSignature = request.headers.get(REQUEST_SIGNATURE_HEADER) || "";
  console.log(`X-Middleman-Signature header: ${providedSignature}`);
  const publicKeyBase64 = Buffer.from(delegator.identity, "hex").toString("base64");
  console.log(`Public key (base64): ${publicKeyBase64}`);
  const isValidSignature = await verifySignature(rawData, publicKeyBase64, providedSignature);

  if (!isValidSignature) {
    console.log('Signature could not be verified with public key.');
    return NextResponse.json(
      { error: `Invalid request. Signature could not be verified with public key: ${delegator.identity}` },
      { status: 400 }
    );
  }

  console.log('Signature verified successfully.');

  return { delegator, data };
}
