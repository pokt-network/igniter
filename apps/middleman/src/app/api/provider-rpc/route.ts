import {z} from "zod";
import urlJoin from 'url-join';
import {GetProviderByIdentity} from "@/actions/Providers";
import {Provider} from "@igniter/db/middleman/schema";
import {signPayload} from "@igniter/commons/crypto";
import {getApplicationSettings} from "@/lib/dal/applicationSettings";
import {REQUEST_IDENTITY_HEADER, REQUEST_SIGNATURE_HEADER} from "@igniter/commons/constants";

export async function POST(request: Request) {
  console.log('Preparing a request to a provider');

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
    console.log('Request payload validated:', JSON.stringify(validatedData, null, 2));
  } catch (error) {
    console.error('Request payload validation failed:', error);
    return new Response("Invalid request payload", {status: 400});
  }

  try {
    console.log('Loading the provider');
    provider = await GetProviderByIdentity(validatedData.provider);
    if (!provider) {
      console.error('Provider not found');
      return new Response("Provider not found", {status: 404});
    }
    console.log('Provider loaded:', JSON.stringify(provider, null, 2));
  } catch (error) {
    console.error(error);
    return new Response("Unable to load the provider", {status: 500});
  }

  try {
    const applicationSettings = await getApplicationSettings();
    identity = applicationSettings.appIdentity;
  } catch (error) {
    console.error(error);
    return new Response("There has been an error while setting the identity of the app", {status: 500});
  }

  try {
    const signatureBuffer = await signPayload(JSON.stringify(validatedData.data));
    signature = signatureBuffer.toString('base64');
  } catch (error) {
    console.error(error);
    return new Response("There has been an error while signing the payload.", {status: 500});
  }

  try {
    console.log('Executing the request');
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

    return new Response(JSON.stringify(responseBody), {status: 200});
  } catch (error) {
    console.error(error);
    return new Response("Unable to fetch the provider", {status: 500});
  }
}
