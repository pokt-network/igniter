jest.mock('@/config/env', () => ({
  env: {
    APP_IDENTITY: 'a'.repeat(64),
    OWNER_IDENTITY: 'pokt1' + 'a'.repeat(38),
    MINIMUM_STAKE_BUFFER: 500000000,
  },
}));

import { isPoktBech32Address, isHexPublicKey, pubkeyToAddress, normalizeIdentityToAddress } from './crypto';

describe('isPoktBech32Address', () => {
  it('returns true for a valid pokt bech32 address', () => {
    expect(isPoktBech32Address('pokt1' + 'a'.repeat(38))).toBe(true);
    expect(isPoktBech32Address('pokt1' + 'z9'.repeat(20))).toBe(true);
  });

  it('returns false for invalid prefix', () => {
    expect(isPoktBech32Address('cosmos1' + 'a'.repeat(38))).toBe(false);
  });

  it('returns false when too short', () => {
    expect(isPoktBech32Address('pokt1' + 'a'.repeat(10))).toBe(false);
  });

  it('returns false for uppercase characters', () => {
    expect(isPoktBech32Address('pokt1' + 'A'.repeat(38))).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPoktBech32Address('')).toBe(false);
  });
});

describe('isHexPublicKey', () => {
  it('returns true for a valid 64-char hex string', () => {
    expect(isHexPublicKey('a'.repeat(64))).toBe(true);
    expect(isHexPublicKey('0123456789abcdefABCDEF' + '0'.repeat(42))).toBe(true);
  });

  it('returns false for wrong length', () => {
    expect(isHexPublicKey('a'.repeat(63))).toBe(false);
    expect(isHexPublicKey('a'.repeat(65))).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(isHexPublicKey('g'.repeat(64))).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHexPublicKey('')).toBe(false);
  });
});

describe('pubkeyToAddress', () => {
  it('derives a deterministic bech32 address from a hex public key', () => {
    const hexPubKey = '02' + 'a'.repeat(64);
    const address = pubkeyToAddress(hexPubKey);

    expect(address).toMatch(/^pokt1[a-z0-9]{38,43}$/);
  });

  it('produces same address for same input', () => {
    const hexPubKey = '02' + '1234567890abcdef'.repeat(4);
    const addr1 = pubkeyToAddress(hexPubKey);
    const addr2 = pubkeyToAddress(hexPubKey);

    expect(addr1).toBe(addr2);
  });

  it('uses custom prefix', () => {
    const hexPubKey = '02' + 'b'.repeat(64);
    const address = pubkeyToAddress(hexPubKey, 'cosmos');

    expect(address).toMatch(/^cosmos1/);
  });
});

describe('normalizeIdentityToAddress', () => {
  it('returns bech32 address as-is', () => {
    const addr = 'pokt1' + 'a'.repeat(38);
    expect(normalizeIdentityToAddress(addr)).toBe(addr);
  });

  it('converts 64-char hex to bech32 address', () => {
    const hex = 'a'.repeat(64);
    const result = normalizeIdentityToAddress(hex);

    expect(result).toMatch(/^pokt1/);
    expect(result).not.toBe(hex);
  });

  it('returns unknown format as-is', () => {
    expect(normalizeIdentityToAddress('short')).toBe('short');
    expect(normalizeIdentityToAddress('')).toBe('');
  });
});
