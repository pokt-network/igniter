import { assertNotRedirect, PROVIDER_FETCH_INIT, ProviderResponseError, readProviderJson } from './providerFetch';

const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

describe('readProviderJson', () => {
  it('returns the JSON body, whatever the status', async () => {
    await expect(readProviderJson(json('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readProviderJson(json('{"error":"x"}', { status: 409 }))).resolves.toEqual({ error: 'x' });
  });

  it('accepts a json content type with parameters or a +json suffix', async () => {
    await expect(readProviderJson(new Response('[]', { headers: { 'content-type': 'application/json; charset=utf-8' } }))).resolves.toEqual([]);
    await expect(readProviderJson(new Response('{}', { headers: { 'content-type': 'application/problem+json' } }))).resolves.toEqual({});
  });

  it('refuses a redirect', async () => {
    const response = new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    await expect(readProviderJson(response)).rejects.toBeInstanceOf(ProviderResponseError);
    expect(() => assertNotRedirect(response)).toThrow('redirect');
  });

  it('refuses a body that is not JSON (e.g. an internal HTML or metrics page)', async () => {
    await expect(readProviderJson(new Response('# HELP up', { headers: { 'content-type': 'text/plain' } }))).rejects.toThrow('not JSON');
    await expect(readProviderJson(new Response('{}'))).rejects.toThrow('not JSON');
  });

  it('refuses a body over the cap, declared or streamed', async () => {
    await expect(readProviderJson(json('{"a":"' + 'x'.repeat(100) + '"}'), 50)).rejects.toThrow('too large');
    await expect(readProviderJson(json('{}', { headers: { 'content-length': String(10 * 1024 * 1024) } }))).rejects.toThrow('too large');
  });

  it('refuses invalid JSON', async () => {
    await expect(readProviderJson(json('{not json'))).rejects.toThrow('not valid JSON');
  });

  it('fetch init never follows redirects', () => {
    expect(PROVIDER_FETCH_INIT).toEqual({ redirect: 'manual' });
  });
});
