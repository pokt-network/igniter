import { assertDnsAvailable, createGovernanceRegistry, governanceSourceUrl, GovernanceUnavailableError, TransientUrlCheckError } from './governance';

const SOURCE = [
  { name: 'A', identity: 'pokt1a', identityHistory: ['pokt1old'], url: 'https://a.example' },
  { name: 'B', identity: 'pokt1b', identityHistory: [], url: 'https://b.example' },
];

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function setup(fetchImpl: jest.Mock) {
  let clock = 1_000_000;
  const registry = createGovernanceRegistry({
    getSourceUrl: () => 'https://cdn.example/pocket/providers.json',
    fetchFn: fetchImpl as unknown as typeof fetch,
    ttlMs: 600_000,
    now: () => clock,
  });
  return { registry, advance: (ms: number) => { clock += ms; } };
}

describe('governanceSourceUrl', () => {
  it('fills the chain id and maps lego-testnet to beta', () => {
    expect(governanceSourceUrl('https://cdn/{chainId}/p.json', 'pocket')).toBe('https://cdn/pocket/p.json');
    expect(governanceSourceUrl('https://cdn/{chainId}/p.json', 'lego-testnet')).toBe('https://cdn/beta/p.json');
  });
});

describe('createGovernanceRegistry', () => {
  it('returns the governance identity and url for a listed provider', async () => {
    const { registry } = setup(jest.fn().mockResolvedValue(okResponse(SOURCE)));
    await expect(registry.resolve('pokt1a')).resolves.toEqual({ identity: 'pokt1a', url: 'https://a.example' });
  });

  it('does not match an old identity from identityHistory', async () => {
    const { registry } = setup(jest.fn().mockResolvedValue(okResponse(SOURCE)));
    await expect(registry.resolve('pokt1old')).resolves.toBeNull();
  });

  it('returns null for an identity the source does not list', async () => {
    const { registry } = setup(jest.fn().mockResolvedValue(okResponse(SOURCE)));
    await expect(registry.resolve('pokt1other')).resolves.toBeNull();
  });

  it('fails closed when the cache is cold and the source is unreachable', async () => {
    const { registry } = setup(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(registry.resolve('pokt1a')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it('fails closed when the source returns something that is not a provider list', async () => {
    const { registry } = setup(jest.fn().mockResolvedValue(okResponse({ providers: SOURCE })));
    await expect(registry.resolve('pokt1a')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it('fails closed when the source url cannot be built', async () => {
    const registry = createGovernanceRegistry({
      getSourceUrl: () => { throw new Error('PROVIDERS_CDN_URL is not set'); },
      fetchFn: jest.fn() as unknown as typeof fetch,
    });
    await expect(registry.resolve('pokt1a')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it('serves the cached copy within the TTL without fetching again', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(SOURCE));
    const { registry, advance } = setup(fetchImpl);
    await registry.resolve('pokt1a');
    advance(599_000);
    await registry.resolve('pokt1b');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the TTL, so a provider removed from the source stops resolving', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(okResponse(SOURCE))
      .mockResolvedValueOnce(okResponse([SOURCE[1]]));
    const { registry, advance } = setup(fetchImpl);
    await expect(registry.resolve('pokt1a')).resolves.not.toBeNull();
    advance(600_001);
    await expect(registry.resolve('pokt1a')).resolves.toBeNull();
  });

  it('keeps serving the last good copy when a refresh fails', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(okResponse(SOURCE))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { registry, advance } = setup(fetchImpl);
    await registry.resolve('pokt1a');
    advance(600_001);
    await expect(registry.resolve('pokt1a')).resolves.toEqual({ identity: 'pokt1a', url: 'https://a.example' });
  });

  it('shares one fetch between concurrent cold lookups', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(SOURCE));
    const { registry } = setup(fetchImpl);
    await Promise.all([registry.resolve('pokt1a'), registry.resolve('pokt1b')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts an identity-only source (delegators) when urls are not required', async () => {
    const registry = createGovernanceRegistry({
      getSourceUrl: () => 'https://cdn.example/pocket/delegators.json',
      fetchFn: jest.fn().mockResolvedValue(okResponse([{ name: 'M', identity: '02abc', identityHistory: [] }])) as unknown as typeof fetch,
      requireUrl: false,
    });
    await expect(registry.resolve('02abc')).resolves.toEqual({ identity: '02abc', url: '' });
    await expect(registry.resolve('02other')).resolves.toBeNull();
  });

  it('still fails closed on an identity-only source when urls are required', async () => {
    const { registry } = setup(jest.fn().mockResolvedValue(okResponse([{ name: 'M', identity: '02abc' }])));
    await expect(registry.resolve('02abc')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  describe('validateUrl', () => {
    const source = [
      ...SOURCE,
      { name: 'C', identity: 'pokt1c', identityHistory: [], url: 'http://169.254.169.254/' },
    ];

    function withValidator(validateUrl: jest.Mock, body: unknown = source) {
      return createGovernanceRegistry({
        getSourceUrl: () => 'https://cdn.example/pocket/providers.json',
        fetchFn: jest.fn().mockResolvedValue(okResponse(body)) as unknown as typeof fetch,
        validateUrl,
      });
    }

    it('excludes an entry whose url is refused and keeps the others', async () => {
      const validateUrl = jest.fn(async (url: string) => (url.startsWith('https://') ? null : 'url must be https'));
      const registry = withValidator(validateUrl);
      await expect(registry.resolve('pokt1c')).resolves.toBeNull();
      await expect(registry.resolve('pokt1a')).resolves.toEqual({ identity: 'pokt1a', url: 'https://a.example' });
      await expect(registry.resolve('pokt1b')).resolves.toEqual({ identity: 'pokt1b', url: 'https://b.example' });
      expect(validateUrl).toHaveBeenCalledTimes(3);
    });

    it('excludes an entry whose check throws', async () => {
      const validateUrl = jest.fn(async (url: string) => {
        if (url === 'https://b.example') throw new Error('dns down');
        return null;
      });
      const registry = withValidator(validateUrl, SOURCE);
      await expect(registry.resolve('pokt1b')).resolves.toBeNull();
      await expect(registry.resolve('pokt1a')).resolves.toEqual({ identity: 'pokt1a', url: 'https://a.example' });
    });

    it('does not check entries without a url (identity-only source)', async () => {
      const validateUrl = jest.fn(async () => 'refused');
      const registry = createGovernanceRegistry({
        getSourceUrl: () => 'https://cdn.example/pocket/delegators.json',
        fetchFn: jest.fn().mockResolvedValue(okResponse([{ name: 'M', identity: '02abc', identityHistory: [] }])) as unknown as typeof fetch,
        requireUrl: false,
        validateUrl,
      });
      await expect(registry.resolve('02abc')).resolves.toEqual({ identity: '02abc', url: '' });
      expect(validateUrl).not.toHaveBeenCalled();
    });

    it('passes every entry through when no validateUrl is given', async () => {
      const { registry } = setup(jest.fn().mockResolvedValue(okResponse(source)));
      await expect(registry.resolve('pokt1c')).resolves.toEqual({ identity: 'pokt1c', url: 'http://169.254.169.254/' });
    });
  });
});

describe('transient url-check failures', () => {
  const TWO = [
    { name: 'A', identity: 'pokt1a', identityHistory: [], url: 'https://a.example' },
    { name: 'B', identity: 'pokt1b', identityHistory: [], url: 'https://b.example' },
  ];

  function registryWith(validateUrl: (url: string) => Promise<string | null>, urlCheckTimeoutMs?: number) {
    let clock = 1_000_000;
    const fetchFn = jest.fn().mockResolvedValue(okResponse(TWO));
    const registry = createGovernanceRegistry({
      getSourceUrl: () => 'https://cdn.example/pocket/providers.json',
      fetchFn: fetchFn as unknown as typeof fetch,
      ttlMs: 600_000,
      now: () => clock,
      validateUrl,
      urlCheckTimeoutMs,
    });
    return { registry, advance: (ms: number) => { clock += ms; } };
  }

  it('fails a cold refresh closed when any check is transient', async () => {
    const { registry } = registryWith(async (url) => {
      if (url.includes('b.example')) throw new TransientUrlCheckError('DNS lookup failed (EAI_AGAIN)');
      return null;
    });
    await expect(registry.resolve('pokt1a')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it('keeps serving the last-good copy, unchanged, when a later refresh hits a transient failure', async () => {
    let transient = false;
    const { registry, advance } = registryWith(async () => {
      if (transient) throw new TransientUrlCheckError('DNS lookup failed (ETIMEOUT)');
      return null;
    });
    await expect(registry.resolve('pokt1b')).resolves.not.toBeNull();
    transient = true;
    advance(600_001);
    // B stays listed: a DNS blip must not make it look unlisted (that would send releases to manual).
    await expect(registry.resolve('pokt1b')).resolves.toEqual({ identity: 'pokt1b', url: 'https://b.example' });
    await expect(registry.resolve('pokt1a')).resolves.not.toBeNull();
  });

  it('treats a check slower than the bound as transient', async () => {
    const { registry } = registryWith(() => new Promise(() => undefined), 20);
    await expect(registry.resolve('pokt1a')).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it('still drops only the entry a definitive policy check refuses', async () => {
    const { registry } = registryWith(async (url) => (url.includes('b.example') ? 'destination address is not allowed' : null));
    await expect(registry.resolve('pokt1a')).resolves.not.toBeNull();
    await expect(registry.resolve('pokt1b')).resolves.toBeNull();
  });
});

describe('assertDnsAvailable', () => {
  const failing = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };

  it.each(['EAI_AGAIN', 'ETIMEOUT', 'ESERVFAIL'])('throws a transient error when the resolver fails (%s)', async (code) => {
    await expect(assertDnsAvailable('a.example', failing(code))).rejects.toBeInstanceOf(TransientUrlCheckError);
  });

  it('leaves a name that does not exist (ENOTFOUND) to the policy check', async () => {
    await expect(assertDnsAvailable('nope.example', failing('ENOTFOUND'))).resolves.toBeUndefined();
  });

  it('passes when the name resolves', async () => {
    await expect(assertDnsAvailable('a.example', async () => [{ address: '1.2.3.4' }])).resolves.toBeUndefined();
  });
});

