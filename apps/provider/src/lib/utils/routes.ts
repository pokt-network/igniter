import { NextResponse } from "next/server";
import { getApplicationSettings } from "@/lib/dal/applicationSettings";
import { getDelegatorByIdentity } from "@/lib/dal/delegators";
import { verifySignature } from "@igniter/commons/crypto";
import {REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER} from "@igniter/commons/constants";
import {APIResponse} from "@/lib/models/response";
import { getLogger } from "@igniter/logger";

const log = getLogger(["provider", "routes"]);

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
  const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER);

  if (!delegatorIdentity) {
    log.debug('request signature validation failed', { delegator: null, identity: null, verified: false, reason: 'missing identity header' });
    return NextResponse.json(
      { error: "Invalid request. X-Middleman-Identity header was not provided." },
      { status: 400 }
    );
  }

  const delegator = await getDelegatorByIdentity(delegatorIdentity);

  if (!delegator) {
    log.debug('request signature validation failed', { delegator: null, identity: delegatorIdentity, verified: false, reason: 'delegator not found' });
    return NextResponse.json(
      { error: "Forbidden. The client is not allowed." },
      { status: 403 }
    );
  }

  let data: TData;

  try {
    data = await request.json();
  } catch (err) {
    log.error('failed to parse request payload as JSON', { delegator: delegator.name, identity: delegatorIdentity, error: err });
    return NextResponse.json(
      { error: "Invalid request. Is the request valid JSON?" },
      { status: 400 }
    );
  }

  const rawData = JSON.stringify(data);
  const providedSignature = request.headers.get(REQUEST_SIGNATURE_HEADER) || "";
  // NEVER log signature/pubkey values — only the outcome (audit item 6).
  const publicKeyBase64 = Buffer.from(delegator.identity, "hex").toString("base64");
  const isValidSignature = await verifySignature(rawData, publicKeyBase64, providedSignature);

  if (!isValidSignature) {
    log.debug('request signature validation failed', { delegator: delegator.name, identity: delegatorIdentity, verified: false, reason: 'signature mismatch' });
    return NextResponse.json(
      { error: `Invalid request. Signature could not be verified with public key: ${delegator.identity}` },
      { status: 400 }
    );
  }

  log.debug('request signature validated', { delegator: delegator.name, identity: delegatorIdentity, verified: true });

  return { delegator, data };
}
