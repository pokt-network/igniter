import {z} from "zod";
import urlJoin from 'url-join';
import {auth} from "@/auth";
import {getByIdentity} from "@/lib/dal/providers";
import {governance} from "@/lib/governance";
import {GovernanceUnavailableError} from "@igniter/commons/governance";
import {Provider} from "@igniter/db/middleman/schema";
import {signPayload} from "@igniter/commons/crypto";
import {getApplicationSettings} from "@/lib/dal/applicationSettings";
import {REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER} from "@igniter/commons/constants";
import {getLogger, redactObject} from "@igniter/logger";
import {withLogging} from "@/lib/logging/withLogging";
import {PROVIDER_FETCH_INIT, ProviderResponseError, readProviderJson} from "@igniter/commons/providerFetch";
import {claimRelease, markDeliveriesReleased, recordDelivery} from "@/lib/dal/supplierDeliveries";

const log = getLogger(['middleman', 'provider-rpc'])

// The paths whose body carries this middleman's rewards address and rev share. Those two values
// are this server's settings, so they are written here, never taken from the browser.
const DELEGATOR_TERMS_PATHS = new Set([
  '/api/suppliers?simulate=true',
  '/api/suppliers?simulate=false',
  '/api/import-suppliers/submit',
]);

// A real delivery (recorded for this user) and the browser release (only of this user's deliveries).
const DELIVERY_PATH = '/api/suppliers?simulate=false';
const RELEASE_PATH = '/api/suppliers/release';

// The only provider endpoints the middleman UI calls through this route
// (lib/services/provider.ts and lib/services/importSuppliers.ts). Matched as exact
// strings, so a traversal, an absolute url or an extra query never reaches fetch.
const ALLOWED_PATHS = new Set([
  '/api/suppliers?simulate=true',
  '/api/suppliers?simulate=false',
  '/api/suppliers/release',
  '/api/import-suppliers/request',
  '/api/import-suppliers/submit',
  '/api/import-suppliers/status',
]);

export const POST = withLogging(async (request: Request) => {
  const startedAt = Date.now();

  const session = await auth();
  const userIdentity = session?.user?.identity;
  if (!userIdentity) {
    return new Response("Unauthorized", {status: 401});
  }

  const schema = z.object({
    provider: z.string(),
    path: z.string(),
    data: z.any(),
  });

  let validatedData: z.infer<typeof schema>;
  let provider: Provider | undefined;
  let providerUrl: string;
  let identity: string;
  let signature: string;

  try {
    const body = await request.json();
    validatedData = schema.parse(body);
  } catch (error) {
    log.error('provider-rpc payload validation failed', { error })
    return new Response("Invalid request payload", {status: 400});
  }

  if (!ALLOWED_PATHS.has(validatedData.path)) {
    log.warn('provider-rpc path not allowed', { provider: validatedData.provider, path: validatedData.path })
    return new Response("Invalid request payload", {status: 400});
  }

  try {
    provider = await getByIdentity(validatedData.provider);
    // Only the providers the owner enabled and made visible can be reached.
    if (!provider || !provider.enabled || !provider.visible) {
      log.warn('provider-rpc provider not found', { provider: validatedData.provider })
      return new Response("Provider not found", {status: 404});
    }
  } catch (error) {
    log.error('provider-rpc provider lookup failed', { provider: validatedData.provider, error })
    return new Response("Unable to load the provider", {status: 500});
  }

  // The url comes from the governance source, never from the row: a row is not proof that the
  // provider is real, and its url is whatever was written into it.
  try {
    const governed = await governance.resolve(provider.identity);
    if (!governed) {
      log.warn('provider-rpc provider not in the governance source', { provider: provider.identity })
      return new Response("Provider not found", {status: 404});
    }
    providerUrl = governed.url;
  } catch (error) {
    if (error instanceof GovernanceUnavailableError) {
      log.error('provider-rpc governance source unavailable', { provider: provider.identity, error })
      return new Response("The providers list is unavailable", {status: 503});
    }
    log.error('provider-rpc governance lookup failed', { provider: provider.identity, error })
    return new Response("Unable to load the provider", {status: 500});
  }

  try {
    const applicationSettings = await getApplicationSettings();
    identity = applicationSettings.appIdentity;

    if (DELEGATOR_TERMS_PATHS.has(validatedData.path)) {
      validatedData.data = {
        ...(validatedData.data && typeof validatedData.data === 'object' ? validatedData.data : {}),
        delegatorAddress: applicationSettings.delegatorRewardsAddress,
        revSharePercentage: Number(applicationSettings.fee),
      };
    }
  } catch (error) {
    log.error('provider-rpc app identity lookup failed', { error })
    return new Response("There has been an error while setting the identity of the app", {status: 500});
  }

  // Bug 1 (e2e): the browser may release only suppliers delivered to ITS OWN request, and the owner
  // comes from that record. Another user's delivery, or an owner the client names, releases nothing.
  let releasedDeliveryIds: number[] = [];
  if (validatedData.path === RELEASE_PATH) {
    const requested = (validatedData.data as { addresses?: unknown } | null)?.addresses;
    if (!Array.isArray(requested) || requested.length === 0 || !requested.every((a) => typeof a === 'string')) {
      return new Response("Invalid request payload", {status: 400});
    }
    try {
      const claim = await claimRelease(userIdentity, provider.identity, requested);
      if (claim.kind === 'none') {
        log.warn('provider-rpc release refused: no delivery of this user', { provider: provider.identity, user: userIdentity })
        return new Response("Forbidden", {status: 403});
      }
      if (claim.kind === 'mixed-owners') {
        return new Response("Invalid request payload", {status: 400});
      }
      validatedData.data = { addresses: claim.addresses, ownerAddress: claim.ownerAddress };
      releasedDeliveryIds = claim.deliveryIds;
    } catch (error) {
      log.error('provider-rpc delivery lookup failed', { provider: provider.identity, error })
      return new Response("Unable to load the delivery", {status: 500});
    }
  }

  try {
    const signatureBuffer = await signPayload(JSON.stringify(validatedData.data));
    signature = signatureBuffer.toString('base64');
  } catch (error) {
    log.error('provider-rpc payload signing failed', { provider: provider.identity, error })
    return new Response("There has been an error while signing the payload.", {status: 500});
  }

  try {
    log.debug('provider-rpc request payload', redactObject({ provider: provider.identity, path: validatedData.path, data: validatedData.data }))

    const response = await fetch(urlJoin(providerUrl, validatedData.path), {
      ...PROVIDER_FETCH_INIT,
      method: 'POST',
      body: JSON.stringify(validatedData.data),
      headers: {
        "Content-Type": "application/json",
        [REQUEST_IDENTITY_HEADER]: identity,
        [REQUEST_SIGNATURE_HEADER]: signature,
      }
    });

    // Never follows a redirect; the body must be JSON and at most 2 MB.
    const responseBody = await readProviderJson(response);

    if (response.ok) {
      try {
        if (validatedData.path === DELIVERY_PATH) {
          const delivered = (responseBody as { data?: Array<{ operatorAddress?: unknown }> } | null)?.data;
          await recordDelivery({
            userIdentity,
            providerIdentity: provider.identity,
            ownerAddress: String((validatedData.data as { ownerAddress?: unknown })?.ownerAddress ?? ''),
            addresses: Array.isArray(delivered)
              ? delivered.map((s) => s?.operatorAddress).filter((a): a is string => typeof a === 'string')
              : [],
          });
        } else if (validatedData.path === RELEASE_PATH) {
          await markDeliveriesReleased(releasedDeliveryIds);
        }
      } catch (error) {
        // The provider already acted; the record only limits later browser releases.
        log.error('provider-rpc delivery bookkeeping failed', { provider: provider.identity, path: validatedData.path, error })
      }
    }

    log.info('provider-rpc request completed', {
      provider: provider.identity,
      path: validatedData.path,
      status: response.status,
      durationMs: Date.now() - startedAt,
    })

    // The provider's status is passed through (a refusal is no longer reported as 200).
    return new Response(JSON.stringify(responseBody), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof ProviderResponseError) {
      log.warn('provider-rpc provider reply refused', { provider: provider.identity, path: validatedData.path, reason: error.message })
      return new Response("Bad reply from the provider", {status: 502});
    }
    log.error('provider-rpc request failed', {
      provider: provider.identity,
      path: validatedData.path,
      durationMs: Date.now() - startedAt,
      error,
    })
    return new Response("Unable to fetch the provider", {status: 500});
  }
})
