import {
  verifySignature,
  isPoktBech32Address,
  isHexPublicKey,
  pubkeyToAddress,
  normalizeIdentityToAddress,
} from './crypto';
import { Secp256k1, sha256 } from '@cosmjs/crypto';
import { fromHex, toUtf8 } from '@cosmjs/encoding';

// ── isPoktBech32Address ─────────────────────────────────────────────
describe('isPoktBech32Address', () => {
  it('returns true for a valid pokt bech32 address', () => {
    expect(isPoktBech32Address('pokt1' + 'a'.repeat(38))).toBe(true);
  });

  it('returns false for invalid prefix', () => {
    expect(isPoktBech32Address('cosmos1' + 'a'.repeat(38))).toBe(false);
  });

  it('returns false when too short', () => {
    expect(isPoktBech32Address('pokt1abc')).toBe(false);
  });

  it('returns false for uppercase', () => {
    expect(isPoktBech32Address('pokt1' + 'A'.repeat(38))).toBe(false);
  });
});

// ── isHexPublicKey ──────────────────────────────────────────────────
describe('isHexPublicKey', () => {
  it('returns true for valid 64-char hex', () => {
    expect(isHexPublicKey('ab'.repeat(32))).toBe(true);
  });

  it('returns false for wrong length', () => {
    expect(isHexPublicKey('ab'.repeat(31))).toBe(false);
  });

  it('returns false for non-hex chars', () => {
    expect(isHexPublicKey('zz'.repeat(32))).toBe(false);
  });
});

// ── pubkeyToAddress ─────────────────────────────────────────────────
describe('pubkeyToAddress', () => {
  it('derives a deterministic bech32 address', () => {
    const hex = '02' + 'a'.repeat(64);
    const addr = pubkeyToAddress(hex);
    expect(addr).toMatch(/^pokt1[a-z0-9]{38,43}$/);
  });

  it('is deterministic', () => {
    const hex = '02' + 'b'.repeat(64);
    expect(pubkeyToAddress(hex)).toBe(pubkeyToAddress(hex));
  });

  it('supports custom prefix', () => {
    const hex = '02' + 'c'.repeat(64);
    expect(pubkeyToAddress(hex, 'cosmos')).toMatch(/^cosmos1/);
  });
});

// ── normalizeIdentityToAddress ──────────────────────────────────────
describe('normalizeIdentityToAddress', () => {
  it('returns bech32 address unchanged', () => {
    const addr = 'pokt1' + 'a'.repeat(38);
    expect(normalizeIdentityToAddress(addr)).toBe(addr);
  });

  it('converts hex public key to bech32', () => {
    const hex = 'a'.repeat(64);
    expect(normalizeIdentityToAddress(hex)).toMatch(/^pokt1/);
  });

  it('returns unknown format as-is', () => {
    expect(normalizeIdentityToAddress('something-else')).toBe('something-else');
  });
});

// ── verifySignature ─────────────────────────────────────────────────
describe('verifySignature', () => {
  let compressedPubKeyHex: string;
  let payload: string;
  let signatureHex: string;

  beforeAll(async () => {
    // Generate a key pair for testing
    const privKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const privKeyBytes = fromHex(privKeyHex);
    const { pubkey } = await Secp256k1.makeKeypair(privKeyBytes);
    const compressed = Secp256k1.compressPubkey(pubkey);

    compressedPubKeyHex = Buffer.from(compressed).toString('hex');
    payload = 'test-payload';

    const messageHash = sha256(toUtf8(payload));
    const sig = await Secp256k1.createSignature(messageHash, privKeyBytes);
    signatureHex = Buffer.from(sig.toFixedLength()).toString('hex');
  });

  it('returns true for a valid signature', async () => {
    const result = await verifySignature(payload, compressedPubKeyHex, signatureHex, 'hex');
    expect(result).toBe(true);
  });

  it('returns false for a wrong payload', async () => {
    const result = await verifySignature('wrong-payload', compressedPubKeyHex, signatureHex, 'hex');
    expect(result).toBe(false);
  });

  it('returns false for an invalid public key format', async () => {
    const badPubKey = 'aa'.repeat(33); // valid length but wrong prefix
    const result = await verifySignature(payload, badPubKey, signatureHex, 'hex');
    expect(result).toBe(false);
  });

  it('returns false for truncated signature', async () => {
    const result = await verifySignature(payload, compressedPubKeyHex, signatureHex.slice(0, 32), 'hex');
    expect(result).toBe(false);
  });

  it('supports base64 encoding', async () => {
    const pubKeyBase64 = Buffer.from(compressedPubKeyHex, 'hex').toString('base64');
    const sigBase64 = Buffer.from(signatureHex, 'hex').toString('base64');

    const result = await verifySignature(payload, pubKeyBase64, sigBase64, 'base64');
    expect(result).toBe(true);
  });
});
