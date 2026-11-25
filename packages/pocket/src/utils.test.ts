import { assertSecureRpcUrl, isValidPoktAddress, isValidPrivateKey } from './utils';

describe('isValidPrivateKey', () => {
  // A known valid 32-byte hex key (well within the secp256k1 curve order)
  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true for a valid 32-byte private key', () => {
    expect(isValidPrivateKey(validKey)).toBe(true);
  });

  it('returns false for a key that is too short', () => {
    expect(isValidPrivateKey('0123456789abcdef')).toBe(false);
  });

  it('returns false for a zero key', () => {
    const zeroKey = '0'.repeat(64);
    expect(isValidPrivateKey(zeroKey)).toBe(false);
  });

  it('returns false for a key equal to the curve order', () => {
    // secp256k1 curve order n
    const curveOrder = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141';
    expect(isValidPrivateKey(curveOrder)).toBe(false);
  });

  it('returns true for key value of 1 (minimum valid)', () => {
    const minKey = '0'.repeat(62) + '01';
    expect(isValidPrivateKey(minKey)).toBe(true);
  });

  it('returns true for key just below the curve order', () => {
    // n - 1 = FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140
    const maxKey = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140';
    expect(isValidPrivateKey(maxKey)).toBe(true);
  });
});

describe('isValidPoktAddress', () => {
  it('accepts a 20-byte pokt bech32 address', () => {
    expect(isValidPoktAddress('pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723y')).toBe(true);
  });

  it.each([
    ['another chain prefix', 'cosmos1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du'],
    ['a 32-byte payload', 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqsmnl5f7'],
    ['a bad checksum', 'pokt1qyqszqgpqyqszqgpqyqszqgpqyqszqgp04723z'],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('rejects %s', (_label, value) => {
    expect(isValidPoktAddress(value)).toBe(false);
  });
});

describe('assertSecureRpcUrl', () => {
  it.each([
    'https://rpc.example.com',
    'http://localhost:26657',
    'http://127.0.0.1:26657',
    'http://[::1]:26657',
    'http://validator:26657',
  ])('allows %s', (url) => {
    expect(() => assertSecureRpcUrl(url)).not.toThrow();
  });

  it.each([
    'http://rpc.example.com',
    'http://10.0.0.5:26657',
    'ftp://rpc.example.com',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertSecureRpcUrl(url)).toThrow();
  });
});
