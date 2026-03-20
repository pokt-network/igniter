import { isValidPrivateKey } from './utils';

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
