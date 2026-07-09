import {z} from "zod";
import urlJoin from 'url-join';
import {GetProviderByIdentity} from "@/actions/Providers";
import {Provider} from "@igniter/db/middleman/schema";
import {signPayload} from "@igniter/commons/crypto";
import {getApplicationSettings} from "@/lib/dal/applicationSettings";
import {REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER} from "@igniter/commons/constants";
import {getLogger, redactObject} from "@igniter/logger";
import {withLogging} from "@/lib/logging/withLogging";

const log = getLogger(['middleman', 'provider-rpc'])

export const POST = withLogging(async (request: Request) => {
  const startedAt = Date.now();

  const schema = z.object({
    provider: z.string(),
    path: z.string(),
    data: z.any(),
  });

  let validatedData: z.infer<typeof schema>;
  let provider: Provider | undefined;
  let identity: string;
  let signature: string;

  try {
    const body = await request.json();
    validatedData = schema.parse(body);
  } catch (error) {
    log.error('provider-rpc payload validation failed', { error })
    return new Response("Invalid request payload", {status: 400});
  }

  try {
    provider = await GetProviderByIdentity(validatedData.provider);
    if (!provider) {
      log.warn('provider-rpc provider not found', { provider: validatedData.provider })
      return new Response("Provider not found", {status: 404});
    }
  } catch (error) {
    log.error('provider-rpc provider lookup failed', { provider: validatedData.provider, error })
    return new Response("Unable to load the provider", {status: 500});
  }

  try {
    const applicationSettings = await getApplicationSettings();
    identity = applicationSettings.appIdentity;
  } catch (error) {
    log.error('provider-rpc app identity lookup failed', { error })
    return new Response("There has been an error while setting the identity of the app", {status: 500});
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

    const response = await fetch(urlJoin(provider.url, validatedData.path), {
      method: 'POST',
      body: JSON.stringify(validatedData.data),
      headers: {
        "Content-Type": "application/json",
        [REQUEST_IDENTITY_HEADER]: identity,
        [REQUEST_SIGNATURE_HEADER]: signature,
      }
    });

    const responseBody = await response.json();

    log.info('provider-rpc request completed', {
      provider: provider.identity,
      path: validatedData.path,
      status: response.status,
      durationMs: Date.now() - startedAt,
    })

    return new Response(JSON.stringify(responseBody), {status: 200});
  } catch (error) {
    log.error('provider-rpc request failed', {
      provider: provider.identity,
      path: validatedData.path,
      durationMs: Date.now() - startedAt,
      error,
    })
    return new Response("Unable to fetch the provider", {status: 500});
  }
})
